import { model, Schema } from 'mongoose';

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Public key for the website widget (pk_live_…). Not a secret: it's visible in the page source,
    // so it can only start widget chats for this workspace. Created on first use.
    publishableKey: { type: String, unique: true, sparse: true },
    // Websites allowed to show the widget, as origins like "https://acme.com".
    allowedOrigins: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const WorkspaceModel = model('Workspace', workspaceSchema);
