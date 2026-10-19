import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ChunkModel, DocumentModel, WorkspaceModel } from '@support-agent/db';
import { app, signedUpBrowser, useTestDb } from './helpers';
import { fakeEmbed } from './fakes';

useTestDb();

async function addDoc(workspaceName: string, filename: string, texts: string[]) {
  const ws = await WorkspaceModel.findOne({ name: workspaceName });
  const doc = await DocumentModel.create({
    workspaceId: ws!._id,
    filename,
    contentType: 'text/plain',
    size: 1,
    s3Key: `k/${filename}`,
    status: 'ready',
  });
  await ChunkModel.insertMany(
    texts.map((text, position) => ({ workspaceId: ws!._id, documentId: doc._id, position, text, embedding: fakeEmbed(text) })),
  );
}

describe('search', () => {
  it('requires login and a question', async () => {
    await request(app).post('/search').send({ query: 'hi' }).expect(401);
    const agent = await signedUpBrowser();
    await agent.post('/search').send({ query: '   ' }).expect(400);
  });

  it('returns the most relevant passage from my documents, with its filename', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await addDoc('Acme', 'faq.txt', [
      'Shipping takes three to five business days.',
      'To reset your password, open settings and choose reset password.',
    ]);

    const res = await agent.post('/search').send({ query: 'how do I reset my password' }).expect(200);
    expect(res.body.results[0]).toMatchObject({ filename: 'faq.txt', text: expect.stringContaining('reset your password') });
  });

  it("never returns another workspace's passages, even a perfect match", async () => {
    const alice = await signedUpBrowser('alice@a.test', 'A Corp');
    await signedUpBrowser('bob@b.test', 'B Corp');
    await addDoc('A Corp', 'a.txt', ['Our refund policy is thirty days.']);
    await addDoc('B Corp', 'secret.txt', ['Bob secret pricing for enterprise deals']);

    const res = await alice.post('/search').send({ query: 'Bob secret pricing for enterprise deals' }).expect(200);
    expect(res.body.results.map((r: { filename: string }) => r.filename)).toEqual(['a.txt']);
  });
});
