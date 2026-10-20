import { randomBytes } from 'node:crypto';
import {
  ConversationModel,
  deleteSequence,
  DocumentModel,
  InboxItemModel,
  type newObjectId,
  nextSequence,
  normalizeQuestion,
  UserModel,
  WorkspaceModel,
} from '@support-agent/db';
import type { Storage } from '@support-agent/storage';
import { DEMO_CHATS, DEMO_DOCUMENTS, DEMO_USER_EMAIL, DEMO_WORKSPACE_NAME, type DemoChat } from './content';

export type DemoDeps = {
  storage: Storage;
  enqueueIngest(documentId: string): Promise<unknown>;
  webUrl: string;
  demoShopSecret?: string;
};

type Id = ReturnType<typeof newObjectId>;

const HOUR_MS = 60 * 60 * 1000;
const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A well-formed bcrypt hash of a random secret nobody knows: the demo owner can't log in with a password. */
const unguessableHash = () => '$2b$12$' + [...randomBytes(53)].map((b) => BCRYPT_ALPHABET[b % 64]).join('');

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

/** Creates the demo workspace, its owner and its documents if any are missing. Safe to run every time. */
export async function ensureDemo({ storage, enqueueIngest }: DemoDeps) {
  let workspace = await WorkspaceModel.findOne({ isDemo: true });
  if (!workspace) {
    try {
      workspace = await WorkspaceModel.create({ name: DEMO_WORKSPACE_NAME, isDemo: true });
    } catch (err) {
      // Another worker created it a moment ago (unique index on isDemo).
      if (!isDuplicateKey(err)) throw err;
      workspace = await WorkspaceModel.findOne({ isDemo: true });
      if (!workspace) throw err;
    }
  }
  const workspaceId = workspace._id;

  if (!(await UserModel.exists({ workspaceId }))) {
    await UserModel.create({ email: DEMO_USER_EMAIL, passwordHash: unguessableHash(), workspaceId });
  }

  for (const file of DEMO_DOCUMENTS) {
    if (await DocumentModel.exists({ workspaceId, filename: file.filename })) continue;
    // Same path as an upload: record → file in S3 → ingest job (extract, chunk, embed, index).
    const doc = new DocumentModel({ workspaceId, filename: file.filename, contentType: 'text/markdown', size: Buffer.byteLength(file.text), s3Key: 'pending' });
    doc.s3Key = `workspaces/${String(workspaceId)}/documents/${String(doc._id)}.md`;
    await doc.save();
    await storage.put(doc.s3Key, file.text, 'text/markdown');
    await DocumentModel.updateOne({ _id: doc._id }, { status: 'queued' });
    await enqueueIngest(String(doc._id));
  }
  return workspace;
}

/**
 * Puts the demo back to its starting state: visitors' chats and Inbox changes are replaced with
 * the sample ones (dated relative to now, so "last 7 days" is never empty), settings restored.
 * Documents are kept: the demo can't change them, and re-embedding every night would waste quota.
 */
export async function resetDemo(deps: DemoDeps, now = new Date()) {
  const workspace = await ensureDemo(deps);
  const workspaceId = workspace._id;

  await Promise.all([ConversationModel.deleteMany({ workspaceId }), InboxItemModel.deleteMany({ workspaceId })]);
  await deleteSequence(`inbox:${String(workspaceId)}`);

  await WorkspaceModel.updateOne(
    { _id: workspaceId },
    {
      name: DEMO_WORKSPACE_NAME,
      allowedOrigins: [new URL(deps.webUrl).origin],
      publishableKey: workspace.publishableKey ?? 'pk_live_' + randomBytes(18).toString('base64url'),
      notifyEmail: null,
      orderWebhookUrl: deps.demoShopSecret ? new URL('/demo-shop/orders', deps.webUrl).toString() : null,
      webhookSecret: deps.demoShopSecret ?? null,
    },
  );

  const docs = await DocumentModel.find({ workspaceId }, { filename: 1 }).lean();
  const docIdFor = (index: number) => docs.find((d) => d.filename === DEMO_DOCUMENTS[index]!.filename)?._id;

  // Oldest first, so Inbox numbers (T-0001…) follow the order things happened.
  const chats = [...DEMO_CHATS].sort((a, b) => b.hoursAgo - a.hoursAgo);
  for (const [i, chat] of chats.entries()) {
    const conversation = await insertChat(workspaceId, chat, randomBytes(8).toString('hex'), now, docIdFor);
    if (chat.inbox) {
      const number = await nextSequence(`inbox:${String(workspaceId)}`);
      await InboxItemModel.create(
        [{ ...chat.inbox, workspaceId, conversationId: conversation._id, number, idempotencyKey: `demo:${i}`, createdAt: conversation.updatedAt, updatedAt: conversation.updatedAt }],
        { timestamps: false },
      );
    }
  }
  return { conversations: chats.length, inboxItems: chats.filter((c) => c.inbox).length };
}

async function insertChat(
  workspaceId: Id,
  chat: DemoChat,
  visitorId: string,
  now: Date,
  docIdFor: (index: number) => Id | undefined,
) {
  let at = now.getTime() - chat.hoursAgo * HOUR_MS;
  const messages = chat.turns.flatMap((turn) => {
    const asked = new Date(at);
    const answered = new Date(at + turn.ms + 900);
    at += 45_000; // the customer reads and types the next message
    const sources = turn.cites
      ?.map((index, k) => ({ documentId: docIdFor(index), filename: DEMO_DOCUMENTS[index]!.filename, position: 0, score: 0.84 - k * 0.04 }))
      .filter((s) => s.documentId);
    return [
      { role: 'user' as const, content: turn.q, createdAt: asked },
      {
        role: 'assistant' as const,
        content: turn.a,
        createdAt: answered,
        sources: sources?.length ? sources : undefined,
        firstTokenMs: turn.ms,
        totalMs: turn.ms + 900,
        actions: turn.actions,
        question: turn.q,
        questionKey: normalizeQuestion(turn.q),
        unanswered: Boolean(turn.unanswered),
        feedback: turn.feedback,
      },
    ];
  });
  const updatedAt = messages[messages.length - 1]!.createdAt;
  const [conversation] = await ConversationModel.create(
    [
      {
        workspaceId,
        title: chat.turns[0]!.q.slice(0, 80),
        channel: chat.channel,
        visitorId: chat.channel === 'widget' ? visitorId : undefined,
        needsHuman: Boolean(chat.needsHuman),
        messages,
        createdAt: messages[0]!.createdAt,
        updatedAt,
      },
    ],
    { timestamps: false },
  );
  return conversation!;
}
