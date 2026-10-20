import { z } from '@support-agent/config';
import { ConversationModel, InboxItemModel, nextSequence, UserModel, type InboxKind } from '@support-agent/db';
import type { ToolCall, ToolDeclaration } from '@support-agent/llm';
import type { Notifier } from './notifier';
import type { OrderLookup } from './order-lookup';
import { UnsafeUrlError } from './order-lookup';

type ConversationDoc = InstanceType<typeof ConversationModel>;

export type ToolContext = {
  workspace: { id: string; name: string; orderWebhookUrl?: string | null; webhookSecret?: string | null; notifyEmail?: string | null; isDemo?: boolean };
  conversation: ConversationDoc;
  orders: OrderLookup;
  notifier: Notifier;
  log: { warn: (obj: object, msg: string) => void };
};

type Tool<A> = {
  declaration: ToolDeclaration;
  args: z.ZodType<A>;
  /**
   * Creates something for the business, so it only runs after the customer confirmed (see
   * executeTool). Returns who the action is for (email / phone): changing that needs a new "yes";
   * rewording the summary doesn't (models rarely produce identical text twice).
   */
  confirmFor?: (args: A) => string;
  /** Short status shown to the customer while the tool runs. */
  label: (args: A) => string;
  /** Bookkeeping only: no status line is shown to the customer. */
  internal?: boolean;
  run: (args: A, ctx: ToolContext) => Promise<unknown>;
};

const email = z.string().trim().toLowerCase().pipe(z.email());

const inboxNumber = (n: number) => `T-${String(n).padStart(4, '0')}`;

/**
 * Saves an inbox item once per conversation+action (the unique idempotency key turns a repeat
 * into "here's the existing one") and emails the team. Email failure never fails the action.
 */
async function createInboxItem(
  ctx: ToolContext,
  key: string,
  item: { kind: InboxKind; summary: string; details?: string; customerEmail?: string; customerPhone?: string; preferredTime?: string },
) {
  const idempotencyKey = `${String(ctx.conversation._id)}:${key}`;
  const existing = await InboxItemModel.findOne({ workspaceId: ctx.workspace.id, idempotencyKey });
  if (existing) return { created: false, number: inboxNumber(existing.number) };
  try {
    const number = await nextSequence(`inbox:${ctx.workspace.id}`);
    await InboxItemModel.create({ ...item, workspaceId: ctx.workspace.id, conversationId: ctx.conversation._id, number, idempotencyKey });
    void notifyTeam(ctx, `${inboxNumber(number)} ${item.kind}: ${item.summary}`, item);
    return { created: true, number: inboxNumber(number) };
  } catch (err) {
    // Two identical calls raced past the check: the unique index let exactly one through.
    if ((err as { code?: number }).code === 11000) {
      const winner = await InboxItemModel.findOne({ workspaceId: ctx.workspace.id, idempotencyKey });
      if (winner) return { created: false, number: inboxNumber(winner.number) };
    }
    throw err;
  }
}

async function notifyTeam(ctx: ToolContext, subject: string, item: Record<string, unknown>) {
  // Anyone can use the demo, so it must never send email (it could be aimed at a stranger's inbox).
  if (ctx.workspace.isDemo) return;
  try {
    const to =
      ctx.workspace.notifyEmail ?? (await UserModel.findOne({ workspaceId: ctx.workspace.id }, { email: 1 }).sort({ createdAt: 1 }))?.email;
    if (!to) return;
    const lines = Object.entries(item).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v)}`);
    await ctx.notifier.notify({ to, subject: `[${ctx.workspace.name}] ${subject}`, text: `${lines.join('\n')}\n\nOpen your dashboard Inbox to follow up.` });
  } catch (err) {
    ctx.log.warn({ err }, 'team notification failed');
  }
}

const getOrderStatus: Tool<{ orderId: string; email: string }> = {
  declaration: {
    name: 'get_order_status',
    description: "Look up an order's status. Needs the order number AND the email address used for the order; ask the customer for any that is missing.",
    parameters: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'Order number, e.g. 1042' }, email: { type: 'string', description: 'Email used for the order' } },
      required: ['orderId', 'email'],
    },
  },
  args: z.object({ orderId: z.string().trim().min(1).max(40), email }),
  label: (a) => `Checking order ${a.orderId}…`,
  async run(args, ctx) {
    const { orderWebhookUrl: url, webhookSecret: secret } = ctx.workspace;
    if (!url || !secret) return { error: 'Order lookup is not set up for this business. Offer to create a ticket instead.' };
    try {
      const result = await ctx.orders.lookup({ url, secret }, args);
      // Same answer for "no such order" and "wrong email": no hint that an order number exists.
      return result.found ? result : { found: false, note: 'No order matches that number and email.' };
    } catch (err) {
      ctx.log.warn({ err }, 'order lookup failed');
      const reason = err instanceof UnsafeUrlError ? 'is misconfigured' : 'is not responding';
      return { error: `The order system ${reason}. Offer to create a ticket instead.` };
    }
  },
};

const createTicket: Tool<{ summary: string; details: string; email: string }> = {
  declaration: {
    name: 'create_ticket',
    description: "Open a support ticket for the team when you can't resolve the issue (damaged item, refund problem, complaint). Needs a short summary, the details, and the customer's email.",
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One line, e.g. "Order 1042 arrived damaged"' },
        details: { type: 'string', description: 'What happened, in the customer’s words' },
        email: { type: 'string', description: 'Customer email for the reply' },
      },
      required: ['summary', 'details', 'email'],
    },
  },
  args: z.object({ summary: z.string().trim().min(3).max(200), details: z.string().trim().max(2000), email }),
  confirmFor: (a) => a.email,
  label: () => 'Creating a ticket…',
  async run(args, ctx) {
    // At most one ticket per customer email per conversation, however the model words it.
    const r = await createInboxItem(ctx, `ticket:${args.email}`, {
      kind: 'ticket',
      summary: args.summary,
      details: args.details,
      customerEmail: args.email,
    });
    return { ok: true, ticket: r.number, alreadyExisted: !r.created, reply: `The team will email ${args.email}.` };
  },
};

const requestCallback: Tool<{ phone: string; preferredTime: string; reason: string }> = {
  declaration: {
    name: 'request_callback',
    description: 'Ask the team to phone the customer back. Needs a phone number, a preferred time, and the reason.',
    parameters: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        preferredTime: { type: 'string', description: 'e.g. "tomorrow after 4pm"' },
        reason: { type: 'string' },
      },
      required: ['phone', 'preferredTime', 'reason'],
    },
  },
  args: z.object({
    phone: z.string().trim().regex(/^[+\d][\d\s()-]{6,20}$/, 'not a phone number'),
    preferredTime: z.string().trim().min(2).max(100),
    reason: z.string().trim().min(3).max(500),
  }),
  confirmFor: (a) => a.phone.replace(/\D/g, ''),
  label: () => 'Requesting a call-back…',
  async run(args, ctx) {
    const r = await createInboxItem(ctx, `callback:${args.phone.replace(/\D/g, '')}`, {
      kind: 'callback',
      summary: `Call back: ${args.reason}`.slice(0, 200),
      customerPhone: args.phone,
      preferredTime: args.preferredTime,
    });
    return { ok: true, request: r.number, alreadyExisted: !r.created };
  },
};

const handoffToHuman: Tool<{ reason: string }> = {
  declaration: {
    name: 'handoff_to_human',
    description: 'Flag this conversation for a person on the team: when the customer asks for a human, is upset, or you cannot help.',
    parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
  },
  args: z.object({ reason: z.string().trim().min(3).max(500) }),
  label: () => 'Asking a team member to join…',
  async run(args, ctx) {
    await ConversationModel.updateOne({ _id: ctx.conversation._id }, { needsHuman: true });
    const r = await createInboxItem(ctx, 'handoff', { kind: 'handoff', summary: `Handoff: ${args.reason}`.slice(0, 200) });
    return { ok: true, reference: r.number, reply: 'A team member has been notified and will follow up.' };
  },
};

export const FLAG_UNANSWERED = 'flag_unanswered';

/**
 * The agent reporting a gap in the business's docs. Retrieval scores can't tell "related passage"
 * from "passage that answers it" (Phase 3), so the model — which reads the passages — says so.
 * Recorded on the answer and listed in Insights → "Questions the agent couldn't answer".
 */
const flagUnanswered: Tool<{ topic: string }> = {
  declaration: {
    name: FLAG_UNANSWERED,
    description:
      "Call this when a customer asks about this business and neither the sources nor the other tools answer it, before you tell them you don't know. Do NOT call it for off-topic questions (general knowledge, chit-chat) or when you only need more details from the customer.",
    parameters: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'What was asked, in a few words, e.g. "student discount"' } },
      required: ['topic'],
    },
  },
  args: z.object({ topic: z.string().trim().min(1).max(200) }),
  internal: true,
  label: () => '',
  run: async () => ({ ok: true, reply: "Recorded. Now tell the customer you don't know and suggest contacting the support team." }),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each tool has its own argument type
export const TOOLS: Record<string, Tool<any>> = {
  get_order_status: getOrderStatus,
  create_ticket: createTicket,
  request_callback: requestCallback,
  handoff_to_human: handoffToHuman,
  [FLAG_UNANSWERED]: flagUnanswered,
};

export const isInternalTool = (name: string) => Boolean(TOOLS[name]?.internal);

export const TOOL_DECLARATIONS = Object.values(TOOLS).map((t) => t.declaration);

export type ToolOutcome = { label: string; ok: boolean; result: unknown };

/**
 * Runs one tool call from the model. The model only *asks*; this decides:
 * unknown tool → error, bad arguments → error back to the model (so it can fix them),
 * actions that create something → only after the customer confirmed, enforced here.
 */
export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome> {
  const tool = TOOLS[call.name];
  if (!tool) return { label: 'Working…', ok: false, result: { error: `Unknown tool ${call.name}` } };

  const parsed = tool.args.safeParse(call.args);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { label: 'Working…', ok: false, result: { error: `Invalid arguments (${problems}). Ask the customer for correct details.` } };
  }
  const label = tool.label(parsed.data);

  let args = parsed.data;
  if (tool.confirmFor) {
    // Server-enforced confirmation: the first request only records the proposal. It runs only when
    // the same action, for the same person, is requested again after a newer customer message
    // (their "yes") — and then exactly as proposed, i.e. what the customer was shown.
    const key = `${call.name}:${tool.confirmFor(parsed.data)}`;
    const userMessages = ctx.conversation.messages.filter((m) => m.role === 'user').length;
    const pending = ctx.conversation.pendingAction;
    if (!pending || pending.key !== key || (pending.userMessages ?? 0) >= userMessages) {
      ctx.conversation.pendingAction = { key, tool: call.name, args: JSON.stringify(parsed.data), userMessages };
      await ConversationModel.updateOne({ _id: ctx.conversation._id }, { pendingAction: ctx.conversation.pendingAction });
      return {
        label: 'Preparing…',
        ok: true,
        result: {
          status: 'confirmation_required',
          instruction: 'Do not say it is done. Show the customer these exact details and ask them to confirm. Call the tool again with the same details only after they say yes.',
          details: parsed.data,
        },
      };
    }
    args = tool.args.parse(JSON.parse(pending.args ?? '{}'));
    ctx.conversation.pendingAction = null;
    await ConversationModel.updateOne({ _id: ctx.conversation._id }, { pendingAction: null });
  }

  try {
    return { label, ok: true, result: await tool.run(args, ctx) };
  } catch (err) {
    ctx.log.warn({ err, tool: call.name }, 'tool failed');
    return { label, ok: false, result: { error: 'That action failed. Apologise and offer to hand off to a person.' } };
  }
}
