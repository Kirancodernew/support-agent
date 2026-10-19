import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel } from '@support-agent/db';
import { app, browser, signedUpBrowser, useTestDb } from './helpers';

useTestDb();

describe('signup', () => {
  it('creates a user and workspace, logs them in, and never returns the password', async () => {
    const agent = browser();
    const res = await agent
      .post('/auth/signup')
      .send({ email: '  Owner@Acme.TEST ', password: 'correct-horse', workspaceName: 'Acme' })
      .expect(201);

    expect(res.body.user.email).toBe('owner@acme.test');
    expect(res.body.workspace.name).toBe('Acme');
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const cookie = res.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toMatch(/^sa_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await agent.get('/auth/me').expect(200);
    expect(me.body.user.email).toBe('owner@acme.test');
  });

  it('stores a bcrypt hash, not the password', async () => {
    await signedUpBrowser();
    const user = await UserModel.findOne({ email: 'owner@acme.test' });
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(user?.passwordHash).not.toContain('correct-horse');
  });

  it('rejects a second account with the same email, ignoring case', async () => {
    await signedUpBrowser('owner@acme.test');
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'OWNER@acme.test', password: 'another-pass', workspaceName: 'Other' })
      .expect(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('lists every invalid field', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send({ email: 'nope', password: 'short', workspaceName: '' })
      .expect(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual(['email', 'password', 'workspaceName']);
  });

  it('rejects malformed JSON with 400, not 500', async () => {
    await request(app).post('/auth/signup').set('Content-Type', 'application/json').send('{"email":').expect(400);
  });
});

describe('login and logout', () => {
  it('logs in with the right password', async () => {
    await signedUpBrowser();
    const agent = browser();
    await agent.post('/auth/login').send({ email: 'owner@acme.test', password: 'correct-horse' }).expect(200);
    await agent.get('/auth/me').expect(200);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    await signedUpBrowser();
    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: 'owner@acme.test', password: 'wrong-password' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@acme.test', password: 'wrong-password' })
      .expect(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  it('logout ends the session', async () => {
    const agent = await signedUpBrowser();
    await agent.post('/auth/logout').expect(204);
    await agent.get('/auth/me').expect(401);
  });

  it('rejects a missing or tampered session cookie', async () => {
    await request(app).get('/auth/me').expect(401);
    await request(app).get('/auth/me').set('Cookie', 'sa_session=not.a.jwt').expect(401);
  });

  it('rejects a correctly signed token whose ids are malformed (401, not a crash)', async () => {
    const token = jwt.sign({ wid: 'not-an-id' }, process.env.JWT_SECRET ?? '', { subject: 'also-not-an-id' });
    await request(app).get('/auth/me').set('Cookie', `sa_session=${token}`).expect(401);
    await request(app).get('/api-keys').set('Cookie', `sa_session=${token}`).expect(401);
  });
});
