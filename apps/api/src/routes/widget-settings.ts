import { Router } from 'express';
import { z } from '@support-agent/config';
import { WorkspaceModel } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { generatePublishableKey } from '../lib/api-key';
import { HttpError } from '../lib/http-error';
import { parseBody } from '../lib/validate';

export const MAX_ALLOWED_ORIGINS = 10;

/** https://any-site, or http only for local testing (localhost / 127.0.0.1). */
function isAllowedOriginInput(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  } catch {
    return false;
  }
}

const settingsSchema = z.object({
  allowedOrigins: z
    .array(
      z
        .string()
        .trim()
        .refine(isAllowedOriginInput, 'Use a full website address like https://acme.com')
        // Keep only the origin: "https://acme.com/help?x=1" → "https://acme.com".
        .transform((value) => new URL(value).origin),
    )
    .max(MAX_ALLOWED_ORIGINS, `Add at most ${MAX_ALLOWED_ORIGINS} websites`),
});

type WorkspaceDoc = InstanceType<typeof WorkspaceModel>;
const toPublic = (w: WorkspaceDoc) => ({ publishableKey: w.publishableKey, allowedOrigins: w.allowedOrigins });

async function loadWorkspace(workspaceId: string) {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new HttpError(401, 'unauthorized', 'Please log in');
  // Workspaces created before the widget existed get their key on first visit.
  if (!workspace.publishableKey) {
    workspace.publishableKey = generatePublishableKey();
    await workspace.save();
  }
  return workspace;
}

/** The owner's widget setup: the public key, and which websites may show the widget. */
export const widgetSettingsRouter = Router();
widgetSettingsRouter.use(requireAuth);

widgetSettingsRouter.get('/', async (req, res) => {
  res.json(toPublic(await loadWorkspace(getAuth(req).workspaceId)));
});

widgetSettingsRouter.put('/', async (req, res) => {
  const { allowedOrigins } = parseBody(settingsSchema, req.body);
  const workspace = await loadWorkspace(getAuth(req).workspaceId);
  workspace.allowedOrigins = [...new Set(allowedOrigins)];
  await workspace.save();
  res.json(toPublic(workspace));
});

// If a key is being abused, issue a new one; the old snippet stops working immediately.
widgetSettingsRouter.post('/rotate-key', async (req, res) => {
  const workspace = await loadWorkspace(getAuth(req).workspaceId);
  workspace.publishableKey = generatePublishableKey();
  await workspace.save();
  res.json(toPublic(workspace));
});
