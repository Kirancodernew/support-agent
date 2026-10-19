import { model, Schema } from 'mongoose';

export const MAX_MESSAGES_PER_CONVERSATION = 50;

const sourceSchema = new Schema(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    filename: { type: String, required: true },
    position: { type: Number, required: true },
    score: { type: Number, required: true },
  },
  { _id: false },
);

const messageSchema = new Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    // Which passages an answer was built from (shown as citations, and audited in Phase 6).
    sources: { type: [sourceSchema], default: undefined },
    // Latency of an answer: how long until the first word, and until the last.
    firstTokenMs: { type: Number },
    totalMs: { type: Number },
    // The answer stopped early (the user left mid-stream).
    interrupted: { type: Boolean },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const conversationSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    title: { type: String, required: true, maxlength: 80 },
    // Embedded: a conversation is always read whole, and is capped at 50 messages.
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

conversationSchema.index({ workspaceId: 1, updatedAt: -1 });

export const ConversationModel = model('Conversation', conversationSchema);
