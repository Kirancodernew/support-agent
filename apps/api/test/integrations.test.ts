import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPublicHttpsUrl, createWebhookOrderLookup, isPrivateAddress, signWebhook } from '../src/agent/order-lookup';
import { app, fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

describe('SSRF guard', () => {
  it('knows private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it('accepts only public https URLs', async () => {
    await expect(assertPublicHttpsUrl('https://93.184.216.34/orders')).resolves.toBeUndefined();
    for (const bad of [
      'http://93.184.216.34/orders', // not https
      'https://169.254.169.254/latest/meta-data', // cloud metadata
      'https://127.0.0.1/admin',
      'https://user:pass@93.184.216.34/',
      'not a url',
    ]) {
      await expect(assertPublicHttpsUrl(bad), bad).rejects.toThrow();
    }
  });
});

describe('signed order webhook (real HTTP)', () => {
  let server: Server;
  let url = '';
  const seen: { signatureOk: boolean }[] = [];
  const SECRET = 'whsec_shared';

  beforeAll(async () => {
    // A tiny stand-in merchant that verifies our signature, like the demo shop does.
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/redirect') {
          res.writeHead(302, { Location: 'http://169.254.169.254/' }).end();
          return;
        }
        const ts = String(req.headers['x-support-agent-timestamp']);
        const signatureOk = req.headers['x-support-agent-signature'] === `sha256=${signWebhook(SECRET, ts, body)}`;
        seen.push({ signatureOk });
        const { orderId } = JSON.parse(body);
        const order = { id: orderId, status: 'Shipped', email: 'owner@shop.example' };
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ found: true, order }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const lookup = createWebhookOrderLookup({ allowLocalHttp: true });

  it('signs every request so the merchant can verify it', async () => {
    const result = await lookup.lookup({ url, secret: SECRET }, { orderId: '1001', email: 'owner@shop.example' });
    expect(seen.at(-1)).toEqual({ signatureOk: true });
    expect(result).toEqual({ found: true, order: { id: '1001', status: 'Shipped' } }); // email never passed on
  });

  it("hides an order whose email doesn't match, even if the merchant returned it", async () => {
    expect(await lookup.lookup({ url, secret: SECRET }, { orderId: '1001', email: 'attacker@evil.example' })).toEqual({ found: false });
  });

  it('does not follow redirects (they could point somewhere private)', async () => {
    await expect(lookup.lookup({ url: `${url}/redirect`, secret: SECRET }, { orderId: '1', email: 'a@b.example' })).rejects.toThrow();
  });

  it('refuses local addresses unless explicitly in development mode', async () => {
    const productionLookup = createWebhookOrderLookup();
    await expect(productionLookup.lookup({ url, secret: SECRET }, { orderId: '1', email: 'a@b.example' })).rejects.toThrow(/https/);
  });
});

describe('integration settings', () => {
  it('requires login', async () => {
    await request(app).get('/integrations').expect(401);
  });

  it('saves a public https webhook and creates a signing secret', async () => {
    const agent = await signedUpBrowser();
    const res = await agent.put('/integrations').send({ orderWebhookUrl: 'https://93.184.216.34/orders', notifyEmail: 'Team@Acme.example' }).expect(200);
    expect(res.body).toMatchObject({ orderWebhookUrl: 'https://93.184.216.34/orders', notifyEmail: 'team@acme.example' });
    expect(res.body.webhookSecret).toMatch(/^whsec_/);

    const rotated = await agent.post('/integrations/rotate-secret').expect(200);
    expect(rotated.body.webhookSecret).not.toBe(res.body.webhookSecret);
  });

  it('rejects webhook URLs that point at private networks', async () => {
    const agent = await signedUpBrowser();
    for (const bad of ['https://169.254.169.254/latest', 'http://93.184.216.34/orders', 'https://10.0.0.5/orders']) {
      const res = await agent.put('/integrations').send({ orderWebhookUrl: bad, notifyEmail: null }).expect(400);
      expect(res.body.details[0].path).toBe('orderWebhookUrl');
    }
  });

  it('connects the demo shop and tests the connection with the same signed call the agent makes', async () => {
    const agent = await signedUpBrowser();
    const demo = await agent.post('/integrations/use-demo-shop').expect(200);
    expect(demo.body.orderWebhookUrl).toBe('https://web.test/demo-shop/orders');

    const test = await agent.post('/integrations/test').send({ orderId: '1001', email: 'demo@acme.example' }).expect(200);
    expect(test.body).toMatchObject({ ok: true, result: { found: true } });
    expect(fakes.orderCalls.at(-1)).toMatchObject({ url: 'https://web.test/demo-shop/orders' });
  });
});
