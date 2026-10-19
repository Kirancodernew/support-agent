import { model, Schema } from 'mongoose';

export const INBOX_KINDS = ['ticket', 'callback', 'handoff'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Work the agent hands to the business's team: a ticket, a call-back request, or a handoff. */
const inboxItemSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
    // Human-friendly per-workspace number, e.g. 7 → "T-0007".
    number: { type: Number, required: true },
    kind: { type: String, enum: INBOX_KINDS, required: true },
    summary: { type: String, required: true, maxlength: 200 },
    details: { type: String, maxlength: 2000 },
    customerEmail: { type: String },
    customerPhone: { type: String },
    preferredTime: { type: String },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    // Same action in the same conversation = same key. A unique index turns a repeated
    // attempt (a retry, or the model calling twice) into "here's the existing one".
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true },
);

inboxItemSchema.index({ workspaceId: 1, idempotencyKey: 1 }, { unique: true });
inboxItemSchema.index({ workspaceId: 1, status: 1, createdAt: -1 });

export const InboxItemModel = model('InboxItem', inboxItemSchema);
