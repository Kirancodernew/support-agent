import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ChunkModel, ConversationModel, DocumentModel, WorkspaceModel } from '@support-agent/db';
import { WIDGET_LIMITS } from '../src/routes/public';
import { fakeEmbed } from './fakes';
import { app, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

type Agent = Awaited<ReturnType<typeof signedUpBrowser>>;
const SITE = 'https://acme.example';

async function setUpWidget(agent: Agent, origins = [SITE]) {
  const res = await agent.put('/widget-settings').send({ allowedOrigins: origins }).expect(200);
  return res.body.publishableKey as string;
}

async function addDoc(workspaceName: string, text: string) {
  const ws = await WorkspaceModel.findOne({ name: workspaceName });
  const doc = await DocumentModel.create({ workspaceId: ws!._id, filename: 'faq.md', contentType: 'text/plain', size: 1, s3Key: 'k', status: 'ready' });
  await ChunkModel.create({ workspaceId: ws!._id, documentId: doc._id, position: 0, text, embedding: fakeEmbed(text) });
}

/** A visitor's browser on a customer's website asking the widget something. */
function widgetChat(body: Record<string, unknown>, origin = 'https://support-agent.test') {
  return request(app)
    .post('/public/chat')
    .set('Origin', origin)
    .send({ visitorId: 'visitor-aaaa-1111', pageOrigin: SITE, message: 'how long does standard shipping take', ...body })
    .buffer(true)
    .parse((r, cb) => {
      let text = '';
      r.on('data', (c: Buffer) => (text += c.toString()));
      r.on('end', () => cb(null, text));
    });
}

const conversationIdOf = (body: unknown) => /"conversationId":"([a-f0-9]{24})"/.exec(String(body))?.[1];

describe('widget settings', () => {
  it('requires login', async () => {
    await request(app).get('/widget-settings').expect(401);
  });

  it('creates a publishable key on first visit and keeps it', async () => {
    const agent = await signedUpBrowser();
    const first = await agent.get('/widget-settings').expect(200);
    expect(first.body.publishableKey).toMatch(/^pk_live_[A-Za-z0-9_-]{24}$/);
    expect((await agent.get('/widget-settings')).body.publishableKey).toBe(first.body.publishableKey);
  });

  it('stores websites as bare origins, de-duplicated, and rejects unsafe ones', async () => {
    const agent = await signedUpBrowser();
    const ok = await agent
      .put('/widget-settings')
      .send({ allowedOrigins: ['https://acme.example/help?x=1', 'https://acme.example', 'http://localhost:5500'] })
      .expect(200);
    expect(ok.body.allowedOrigins).toEqual(['https://acme.example', 'http://localhost:5500']);

    for (const bad of ['acme.example', 'javascript:alert(1)', 'http://acme.example']) {
      await agent.put('/widget-settings').send({ allowedOrigins: [bad] }).expect(400);
    }
  });

  it('rotating the key stops the old one working', async () => {
    const agent = await signedUpBrowser();
    const oldKey = await setUpWidget(agent);
    const rotated = await agent.post('/widget-settings/rotate-key').expect(200);
    expect(rotated.body.publishableKey).not.toBe(oldKey);
    await request(app).get('/public/widget-config').query({ key: oldKey }).expect(404);
  });
});

describe('public widget', () => {
  it('serves the config for a real key only', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const key = await setUpWidget(agent);
    const res = await request(app).get('/public/widget-config').query({ key }).expect(200);
    expect(res.body).toEqual({ name: 'Acme', allowedOrigins: [SITE] });
    await request(app).get('/public/widget-config').query({ key: 'pk_live_doesnotexist000' }).expect(404);
    await request(app).get('/public/widget-config').query({ key: 'sk_live_wrongkind' }).expect(404);
  });

  it("answers visitors on an allowed website from that workspace's documents", async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const key = await setUpWidget(agent);
    await addDoc('Acme', 'Standard shipping takes 3 to 5 business days.');

    const res = await widgetChat({ key });
    expect(res.status).toBe(200);
    expect(String(res.body)).toContain('"filename":"faq.md"');

    const saved = await ConversationModel.findById(conversationIdOf(res.body)).lean();
    expect(saved).toMatchObject({ channel: 'widget', visitorId: 'visitor-aaaa-1111' });
  });

  it('refuses websites that are not on the list, but allows our own dashboard preview', async () => {
    const agent = await signedUpBrowser();
    const key = await setUpWidget(agent);

    const evil = await widgetChat({ key, pageOrigin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    expect(String(evil.body)).toContain('origin_not_allowed');
    expect((await widgetChat({ key, pageOrigin: undefined })).status).toBe(403);

    // Shown inside our own site: the page origin is the same site that sends the request.
    const preview = await widgetChat({ key, pageOrigin: 'https://support-agent.test' }, 'https://support-agent.test');
    expect(preview.status).toBe(200);
  });

  it('rejects unknown keys and secret keys', async () => {
    expect((await widgetChat({ key: 'pk_live_doesnotexist000' })).status).toBe(404);
    expect((await widgetChat({ key: 'sk_live_abcdefghijklmnop' })).status).toBe(400);
  });

  it("keeps visitors apart: one visitor can't continue another's conversation", async () => {
    const agent = await signedUpBrowser();
    const key = await setUpWidget(agent);
    const first = await widgetChat({ key, visitorId: 'visitor-aaaa-1111' });
    const conversationId = conversationIdOf(first.body);

    expect((await widgetChat({ key, visitorId: 'visitor-bbbb-2222', conversationId })).status).toBe(404);
    expect((await widgetChat({ key, visitorId: 'visitor-aaaa-1111', conversationId })).status).toBe(200);
  });

  it("a key only ever reaches its own workspace's documents", async () => {
    const alice = await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    await setUpWidget(alice);
    const bobKey = await setUpWidget(bob);
    await addDoc('A Corp', 'Alice secret discount code is SAVE50.');

    const res = await widgetChat({ key: bobKey, message: 'alice secret discount code' });
    // Bob's widget never sees Alice's document, even for a perfect match.
    expect(String(res.body)).not.toContain('faq.md');
    expect(String(res.body)).not.toContain('SAVE50');
    expect(String(res.body)).toContain("I don't know");
  });

  it(`limits each visitor to ${WIDGET_LIMITS.perVisitorPerMinute} messages a minute`, async () => {
    const agent = await signedUpBrowser();
    const key = await setUpWidget(agent);
    for (let i = 0; i < WIDGET_LIMITS.perVisitorPerMinute; i++) expect((await widgetChat({ key })).status).toBe(200);
    const blocked = await widgetChat({ key });
    expect(blocked.status).toBe(429);
    // Another visitor on the same site still gets through.
    expect((await widgetChat({ key, visitorId: 'visitor-cccc-3333' })).status).toBe(200);
  });
});
