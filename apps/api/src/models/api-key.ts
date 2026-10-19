import { model, Schema } from 'mongoose';

const apiKeySchema = new Schema(
  {
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    // First characters of the key, safe to display so users can tell keys apart.
    prefix: { type: String, required: true },
    // SHA-256 of the full key. The key itself is never stored.
    keyHash: { type: String, required: true, unique: true },
    lastUsedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Serves the dashboard list: one workspace's active keys, newest first.
apiKeySchema.index({ workspaceId: 1, revokedAt: 1, createdAt: -1 });

export const ApiKeyModel = model('ApiKey', apiKeySchema);
