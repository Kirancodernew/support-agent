import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ChunkModel, DocumentModel } from '@support-agent/db';
import { MAX_DOCUMENTS } from '../src/routes/documents';
import { app, fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

type Agent = Awaited<ReturnType<typeof signedUpBrowser>>;

async function startUpload(agent: Agent, filename = 'guide.pdf', size = 1234) {
  const res = await agent.post('/documents').send({ filename, size }).expect(201);
  return res.body as { document: { id: string; status: string }; upload: { url: string; fields: Record<string, string> } };
}

describe('documents', () => {
  it('requires login', async () => {
    await request(app).get('/documents').expect(401);
    await request(app).post('/documents').send({ filename: 'a.pdf', size: 1 }).expect(401);
  });

  it('creates an upload with a server-chosen key and content type', async () => {
    const agent = await signedUpBrowser();
    const { document, upload } = await startUpload(agent, '../../etc/passwd.md');

    expect(document.status).toBe('uploading');
    // Key comes from ids, never from the filename, so "../" tricks go nowhere.
    expect(upload.fields.key).toMatch(new RegExp(`^workspaces/[a-f0-9]{24}/documents/${document.id}\\.md$`));
    expect(upload.fields['Content-Type']).toBe('text/markdown');
  });

  it('rejects unsupported types and files over 10 MB', async () => {
    const agent = await signedUpBrowser();
    const badType = await agent.post('/documents').send({ filename: 'virus.exe', size: 10 }).expect(400);
    expect(badType.body.details[0].message).toMatch(/PDF, TXT or Markdown/);
    await agent.post('/documents').send({ filename: 'big.pdf', size: 10 * 1024 * 1024 + 1 }).expect(400);
  });

  it('queues processing only once the file is really in storage, and only once', async () => {
    const agent = await signedUpBrowser();
    const { document, upload } = await startUpload(agent);

    const early = await agent.post(`/documents/${document.id}/complete`).expect(409);
    expect(early.body.error).toBe('upload_missing');

    fakes.files.set(upload.fields.key!, new Uint8Array([1]));
    const done = await agent.post(`/documents/${document.id}/complete`).expect(200);
    expect(done.body.document.status).toBe('queued');
    expect(fakes.enqueued).toEqual([document.id]);

    await agent.post(`/documents/${document.id}/complete`).expect(409);
    expect(fakes.enqueued).toHaveLength(1);
  });

  it('lists only my workspace documents, and nobody else can touch them', async () => {
    const alice = await signedUpBrowser('alice@a.test', 'A Corp');
    const bob = await signedUpBrowser('bob@b.test', 'B Corp');
    const { document, upload } = await startUpload(alice);
    fakes.files.set(upload.fields.key!, new Uint8Array([1]));

    expect((await bob.get('/documents')).body.documents).toHaveLength(0);
    await bob.post(`/documents/${document.id}/complete`).expect(404);
    await bob.delete(`/documents/${document.id}`).expect(404);
    expect((await alice.get('/documents')).body.documents).toHaveLength(1);
  });

  it('delete removes the record, its chunks and the stored file', async () => {
    const agent = await signedUpBrowser();
    const { document, upload } = await startUpload(agent);
    const key = upload.fields.key!;
    fakes.files.set(key, new Uint8Array([1]));
    const doc = await DocumentModel.findById(document.id);
    await ChunkModel.create({ workspaceId: doc!.workspaceId, documentId: doc!._id, position: 0, text: 'x', embedding: [1] });

    await agent.delete(`/documents/${document.id}`).expect(204);
    expect(await DocumentModel.countDocuments()).toBe(0);
    expect(await ChunkModel.countDocuments()).toBe(0);
    expect(fakes.files.has(key)).toBe(false);
  });

  it(`caps a workspace at ${MAX_DOCUMENTS} documents`, async () => {
    const agent = await signedUpBrowser();
    for (let i = 0; i < MAX_DOCUMENTS; i++) await startUpload(agent, `doc${i}.txt`);
    const res = await agent.post('/documents').send({ filename: 'one-more.txt', size: 1 }).expect(409);
    expect(res.body.error).toBe('document_limit');
  });
});
