import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from '@support-agent/config';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password';
import { getAuth, requireAuth } from '../auth/require-auth';
import { clearSessionCookie, setSessionCookie } from '../auth/session';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';
import { UserModel } from '../models/user';
import { WorkspaceModel } from '../models/workspace';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email').max(254));

const signupSchema = z.object({
  email,
  // bcrypt only uses the first 72 bytes, so longer passwords would be silently truncated.
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .refine((p) => Buffer.byteLength(p) <= 72, 'Use at most 72 characters'),
  workspaceName: z.string().trim().min(2, 'Use at least 2 characters').max(80),
});

// Login doesn't repeat the signup rules: it only checks the password matches.
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password').max(200) });

type UserDoc = { _id: unknown; email: string };
type WorkspaceDoc = { _id: unknown; name: string };

const toPublic = (user: UserDoc, workspace: WorkspaceDoc) => ({
  user: { id: String(user._id), email: user.email },
  workspace: { id: String(workspace._id), name: workspace.name },
});

const isDuplicateKey = (err: unknown) => (err as { code?: number })?.code === 11000;

export const authRouter = Router();

authRouter.post('/signup', async (req, res) => {
  const body = parseBody(signupSchema, req.body);
  const passwordHash = await hashPassword(body.password);

  // Workspace and user are created together or not at all, so a failure can't leave
  // a workspace with no owner.
  let created: ReturnType<typeof toPublic> | undefined;
  let session: { userId: string; workspaceId: string } | undefined;
  try {
    await mongoose.connection.transaction(async (tx) => {
      const workspace = await new WorkspaceModel({ name: body.workspaceName }).save({ session: tx });
      const user = await new UserModel({ email: body.email, passwordHash, workspaceId: workspace._id }).save({
        session: tx,
      });
      created = toPublic(user, workspace);
      session = { userId: String(user._id), workspaceId: String(workspace._id) };
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new HttpError(409, 'email_taken', 'An account with this email already exists');
    throw err;
  }

  if (!created || !session) throw new Error('signup transaction finished without a user');
  setSessionCookie(res, session);
  res.status(201).json(created);
});

authRouter.post('/login', async (req, res) => {
  const body = parseBody(loginSchema, req.body);
  const user = await UserModel.findOne({ email: body.email });
  const passwordOk = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
  // Same message for "no such email" and "wrong password", so login can't be used to find accounts.
  if (!user || !passwordOk) throw new HttpError(401, 'invalid_credentials', 'Invalid email or password');

  const workspace = await WorkspaceModel.findById(user.workspaceId);
  if (!workspace) throw new Error(`user ${String(user._id)} has no workspace`);

  setSessionCookie(res, { userId: String(user._id), workspaceId: String(workspace._id) });
  res.json(toPublic(user, workspace));
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { userId, workspaceId } = getAuth(req);
  const [user, workspace] = await Promise.all([UserModel.findById(userId), WorkspaceModel.findById(workspaceId)]);
  if (!user || !workspace) {
    // Valid token for an account that no longer exists.
    clearSessionCookie(res);
    throw new HttpError(401, 'unauthorized', 'Please log in');
  }
  res.json(toPublic(user, workspace));
});
