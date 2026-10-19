import { model, Schema } from 'mongoose';

const userSchema = new Schema(
  {
    // Unique index: the database itself rejects a second account with the same email,
    // even if two signups race each other.
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
  },
  { timestamps: true },
);

export const UserModel = model('User', userSchema);
