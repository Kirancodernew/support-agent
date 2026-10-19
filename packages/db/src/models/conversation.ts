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
    // Tools the agent used while answering, for the transcript and Phase 6 analytics.
    actions: { type: [{ tool: String, ok: Boolean, _id: false }], default: undefined },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const conversationSchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    title: { type: String, required: true, maxlength: 80 },
    // Where the chat happened: the owner testing on the dashboard, or a visitor on their website.
    channel: { type: String, enum: ['dashboard', 'widget'], default: 'dashboard' },
    // Anonymous id the widget keeps per browser, so a visitor only ever sees their own chats.
    visitorId: { type: String },
    // An action the agent proposed and the customer hasn't confirmed yet (args = what they were
    // shown). It runs only if requested again for the same person *after* a newer customer message.
    pendingAction: {
      type: new Schema({ key: String, tool: String, args: String, userMessages: Number }, { _id: false }),
      default: null,
    },
    // The agent (or the customer) asked for a person to take over.
    needsHuman: { type: Boolean, default: false },
    // Embedded: a conversation is always read whole, and is capped at 50 messages.
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true },
);

conversationSchema.index({ workspaceId: 1, updatedAt: -1 });
conversationSchema.index({ workspaceId: 1, visitorId: 1, updatedAt: -1 }, { sparse: true });

export const ConversationModel = model('Conversation', conversationSchema);
