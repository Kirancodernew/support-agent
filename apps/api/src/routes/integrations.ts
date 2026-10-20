import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from '@support-agent/config';
import { WorkspaceModel } from '@support-agent/db';
import { assertPublicHttpsUrl, UnsafeUrlError } from '../agent/order-lookup';
import { getAuth, requireAuth } from '../auth/require-auth';
import type { AppDeps } from '../deps';
import { env } from '../env';
import { HttpError } from '../lib/http-error';
import { forbidInDemo } from '../lib/demo';
import { parseBody } from '../lib/validate';

type WorkspaceDoc = InstanceType<typeof WorkspaceModel>;
const toPublic = (w: WorkspaceDoc) => ({
  orderWebhookUrl: w.orderWebhookUrl ?? null,
  // In the demo the secret is the demo shop's real one, and every visitor can see this page.
  webhookSecret: w.isDemo ? (w.webhookSecret ? 'hidden in the demo' : null) : (w.webhookSecret ?? null),
  notifyEmail: w.notifyEmail ?? null,
  demoShopAvailable: Boolean(env.DEMO_SHOP_SECRET),
});

const newSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

const settingsSchema = z.object({
  orderWebhookUrl: z.string().trim().max(500).nullable(),
  notifyEmail: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')).nullable(),
});

const testSchema = z.object({ orderId: z.string().trim().min(1).max(40), email: z.string().trim().pipe(z.email()) });

async function loadWorkspace(workspaceId: string) {
  const workspace = await WorkspaceModel.findById(workspaceId);
  if (!workspace) throw new HttpError(401, 'unauthorized', 'Please log in');
  return workspace;
}

const allowLocalHttp = env.NODE_ENV === 'development';

/** Connect the agent to the business's systems: order lookups and team notifications. */
export function integrationsRouter({ orders }: Pick<AppDeps, 'orders'>) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', async (req, res) => {
    res.json(toPublic(await loadWorkspace(getAuth(req).workspaceId)));
  });

  router.put('/', forbidInDemo('Changing integrations'), async (req, res) => {
    const body = parseBody(settingsSchema, req.body);
    const workspace = await loadWorkspace(getAuth(req).workspaceId);
    if (body.orderWebhookUrl) {
      // Checked when saved (clear feedback) and again before every call (DNS can change).
      await assertPublicHttpsUrl(body.orderWebhookUrl, { allowLocalHttp }).catch((err: unknown) => {
        if (err instanceof UnsafeUrlError) {
          throw new HttpError(400, 'validation_error', err.message, [{ path: 'orderWebhookUrl', message: err.message }]);
        }
        throw err;
      });
      workspace.webhookSecret ??= newSecret();
    }
    workspace.orderWebhookUrl = body.orderWebhookUrl || null;
    workspace.notifyEmail = body.notifyEmail;
    await workspace.save();
    res.json(toPublic(workspace));
  });

  router.post('/rotate-secret', forbidInDemo('Changing integrations'), async (req, res) => {
    const workspace = await loadWorkspace(getAuth(req).workspaceId);
    workspace.webhookSecret = newSecret();
    await workspace.save();
    res.json(toPublic(workspace));
  });

  // Connects the built-in demo shop (a separate endpoint on the web app) so the order tool can be tried.
  router.post('/use-demo-shop', forbidInDemo('Changing integrations'), async (req, res) => {
    if (!env.DEMO_SHOP_SECRET) throw new HttpError(404, 'not_available', 'The demo shop is not set up on this server.');
    const workspace = await loadWorkspace(getAuth(req).workspaceId);
    workspace.orderWebhookUrl = new URL('/demo-shop/orders', env.PUBLIC_WEB_URL).toString();
    workspace.webhookSecret = env.DEMO_SHOP_SECRET;
    await workspace.save();
    res.json(toPublic(workspace));
  });

  // "Test connection": the same signed call the agent makes.
  router.post('/test', async (req, res) => {
    const query = parseBody(testSchema, req.body);
    const workspace = await loadWorkspace(getAuth(req).workspaceId);
    if (!workspace.orderWebhookUrl || !workspace.webhookSecret) {
      throw new HttpError(409, 'not_configured', 'Add your order webhook URL first.');
    }
    try {
      res.json({ ok: true, result: await orders.lookup({ url: workspace.orderWebhookUrl, secret: workspace.webhookSecret }, query) });
    } catch (err) {
      res.json({ ok: false, error: err instanceof Error ? err.message : 'Request failed' });
    }
  });

  return router;
}
