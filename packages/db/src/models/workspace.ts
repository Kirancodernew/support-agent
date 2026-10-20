import { model, Schema } from 'mongoose';

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Public key for the website widget (pk_live_…). Not a secret: it's visible in the page source,
    // so it can only start widget chats for this workspace. Created on first use.
    publishableKey: { type: String, unique: true, sparse: true },
    // Websites allowed to show the widget, as origins like "https://acme.com".
    allowedOrigins: { type: [String], default: [] },
    // The business's own order system. We POST signed lookups to it (see the agent's order tool).
    orderWebhookUrl: { type: String, default: null },
    // Shared secret for signing those requests, so the business can verify they came from us.
    webhookSecret: { type: String, default: null },
    // Where tickets and handoffs are emailed. Empty = the account owner's email.
    notifyEmail: { type: String, default: null },
    // Set when the owner deletes the workspace. Its users are already gone; the worker removes the
    // rest, and the workspace record last, so a set deletingAt always means "purge not finished".
    deletingAt: { type: Date },
    // The public demo ("Try the demo"): read-only settings, capped chat, reset every night.
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Serves the purge sweep: only workspaces being deleted are in this index.
workspaceSchema.index({ deletingAt: 1 }, { partialFilterExpression: { deletingAt: { $type: 'date' } } });

// At most one demo workspace.
workspaceSchema.index({ isDemo: 1 }, { unique: true, partialFilterExpression: { isDemo: true } });

export const WorkspaceModel = model('Workspace', workspaceSchema);
