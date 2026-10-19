import { model, Schema } from 'mongoose';

const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true },
);

export const WorkspaceModel = model('Workspace', workspaceSchema);
