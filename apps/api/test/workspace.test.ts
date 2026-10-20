import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel, WorkspaceModel } from '@support-agent/db';
import { app, browser, fakes, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

const PASSWORD = 'correct-horse'; // signedUpBrowser's password
const remove = (agent: ReturnType<typeof browser>, body: object) => agent.post('/workspace/delete').send(body);

describe('delete workspace', () => {
  it('needs the password and the exact workspace name, and changes nothing otherwise', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    await request(app).post('/workspace/delete').send({ password: PASSWORD, confirmName: 'Acme' }).expect(401);
    await remove(agent, { password: 'wrong-password', confirmName: 'Acme' }).expect(403);
    await remove(agent, { password: PASSWORD, confirmName: 'acme' }).expect(400);
    await remove(agent, {}).expect(400);

    expect(await UserModel.countDocuments()).toBe(1);
    expect((await WorkspaceModel.findOne())!.deletingAt).toBeUndefined();
    expect(fakes.deletions).toEqual([]);
  });

  it('ends access everywhere at once, stops the widget and queues the purge', async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    // The same owner logged in on a second device.
    const otherDevice = browser();
    await otherDevice.post('/auth/login').send({ email: 'owner@acme.test', password: PASSWORD }).expect(200);
    const ws = (await WorkspaceModel.findOne())!;
    await WorkspaceModel.updateOne({ _id: ws._id }, { publishableKey: 'pk_live_acme' });

    const res = await remove(agent, { password: PASSWORD, confirmName: 'Acme' }).expect(202);
    expect(res.headers['set-cookie']?.[0]).toMatch(/sa_session=;/);

    const marked = (await WorkspaceModel.findById(ws._id).lean())!;
    expect(marked.deletingAt).toBeInstanceOf(Date);
    expect(marked.publishableKey).toBeUndefined();
    expect(await UserModel.countDocuments()).toBe(0);
    expect(fakes.deletions).toEqual([String(ws._id)]);

    // Still-valid tokens are refused: the user no longer exists.
    await otherDevice.get('/documents').expect(401);
    await otherDevice.get('/auth/me').expect(401);
    await otherDevice.post('/auth/login').send({ email: 'owner@acme.test', password: PASSWORD }).expect(401);
    await request(app).get('/public/widget-config?key=pk_live_acme').expect(404);

    // The email is free again for a new account.
    await signedUpBrowser('owner@acme.test', 'Acme again');
  });

  it('still deletes when the queue is down (the worker sweep picks it up)', async () => {
    const agent = await signedUpBrowser();
    fakes.queueState.down = true;
    await remove(agent, { password: PASSWORD, confirmName: 'Acme' }).expect(202);
    expect(await WorkspaceModel.countDocuments({ deletingAt: { $type: 'date' } })).toBe(1);
    expect(await UserModel.countDocuments()).toBe(0);
  });

  it("doesn't touch other workspaces", async () => {
    const agent = await signedUpBrowser('owner@acme.test', 'Acme');
    const other = await signedUpBrowser('owner@other.test', 'Other');
    await remove(agent, { password: PASSWORD, confirmName: 'Acme' }).expect(202);
    await other.get('/auth/me').expect(200);
    expect((await WorkspaceModel.findOne({ name: 'Other' }))!.deletingAt).toBeUndefined();
  });
});
