import { Router } from 'express';
import { z } from '@support-agent/config';
import { runInTransaction, UserModel, WorkspaceModel } from '@support-agent/db';
import { verifyPassword } from '../auth/password';
import { getAuth, requireAuth } from '../auth/require-auth';
import { clearSessionCookie } from '../auth/session';
import type { AppDeps } from '../deps';
import { HttpError } from '../lib/http-error';
import { forbidInDemo } from '../lib/demo';
import { parseBody } from '../lib/validate';

const deleteSchema = z.object({
  password: z.string().min(1, 'Enter your password').max(200),
  // Typing the name proves the owner means this workspace, not a slip of the mouse.
  confirmName: z.string().trim().min(1, 'Type the workspace name').max(80),
});

export function workspaceRouter(deps: Pick<AppDeps, 'jobs'>) {
  const router = Router();
  router.use(requireAuth);

  /**
   * Deletes the workspace and everything in it. Access ends now (users removed in the same
   * transaction that marks the workspace); files, chunks, chats and keys are removed by the worker.
   */
  router.post('/delete', forbidInDemo('Deleting the workspace'), async (req, res) => {
    const body = parseBody(deleteSchema, req.body);
    const { userId, workspaceId } = getAuth(req);
    const [user, workspace] = await Promise.all([UserModel.findById(userId), WorkspaceModel.findById(workspaceId)]);
    if (!user || !workspace) throw new HttpError(401, 'unauthorized', 'Please log in');
    if (workspace.isDemo) throw new HttpError(403, 'demo_read_only', 'The demo workspace can’t be deleted.');

    // Re-enter the password: a session left open on a shared computer mustn't be enough.
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      throw new HttpError(403, 'wrong_password', 'Wrong password');
    }
    if (body.confirmName !== workspace.name) {
      throw new HttpError(400, 'confirm_mismatch', 'The name doesn’t match this workspace');
    }

    await runInTransaction(async (tx) => {
      // Removing the publishable key stops the widget on every website straight away.
      await WorkspaceModel.updateOne(
        { _id: workspace._id },
        { $set: { deletingAt: new Date() }, $unset: { publishableKey: 1 } },
        { session: tx },
      );
      await UserModel.deleteMany({ workspaceId: workspace._id }, { session: tx });
    });

    // If this fails the deletion still happens: the worker's sweep finds every marked workspace.
    await deps.jobs.deleteWorkspace(workspaceId).catch((err: unknown) => {
      req.log.error({ err, workspaceId }, 'could not enqueue workspace deletion; the sweep will retry');
    });
    req.log.info({ workspaceId }, 'workspace deletion started');

    clearSessionCookie(res);
    res.status(202).json({ status: 'deleting' });
  });

  return router;
}
