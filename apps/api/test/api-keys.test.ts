import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { hashApiKey } from '../src/lib/api-key';
import { ApiKeyModel } from '../src/models/api-key';
import { app, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

describe('API keys', () => {
  it('requires login', async () => {
    await request(app).get('/api-keys').expect(401);
    await request(app).post('/api-keys').send({ name: 'x' }).expect(401);
  });

  it('shows the full key once and stores only its hash', async () => {
    const agent = await signedUpBrowser();
    const created = await agent.post('/api-keys').send({ name: 'Website widget' }).expect(201);

    const { key, apiKey } = created.body;
    expect(key).toMatch(/^sk_live_[A-Za-z0-9_-]{32}$/);
    expect(apiKey.prefix).toBe(key.slice(0, 12));

    const stored = await ApiKeyModel.findById(apiKey.id).lean();
    expect(stored?.keyHash).toBe(hashApiKey(key));
    expect(JSON.stringify(stored)).not.toContain(key);

    const list = await agent.get('/api-keys').expect(200);
    expect(list.body.apiKeys).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(key);
    expect(JSON.stringify(list.body)).not.toContain('keyHash');
  });

  it('revokes a key', async () => {
    const agent = await signedUpBrowser();
    const { body } = await agent.post('/api-keys').send({ name: 'temp' }).expect(201);

    await agent.delete(`/api-keys/${body.apiKey.id}`).expect(204);
    expect((await agent.get('/api-keys')).body.apiKeys).toHaveLength(0);
    await agent.delete(`/api-keys/${body.apiKey.id}`).expect(404); // already revoked
  });

  it("never lets one workspace see or revoke another's keys", async () => {
    const alice = await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    const { body } = await alice.post('/api-keys').send({ name: 'alice key' }).expect(201);

    expect((await bob.get('/api-keys')).body.apiKeys).toHaveLength(0);
    await bob.delete(`/api-keys/${body.apiKey.id}`).expect(404);
    expect((await alice.get('/api-keys')).body.apiKeys).toHaveLength(1);
  });

  it('returns 404 for a malformed id instead of crashing', async () => {
    const agent = await signedUpBrowser();
    await agent.delete('/api-keys/not-an-id').expect(404);
  });

  it('caps active keys at 10', async () => {
    const agent = await signedUpBrowser();
    for (let i = 0; i < 10; i++) await agent.post('/api-keys').send({ name: `k${i}` }).expect(201);
    const res = await agent.post('/api-keys').send({ name: 'one too many' }).expect(409);
    expect(res.body.error).toBe('key_limit');
  });
});
