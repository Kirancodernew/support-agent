import { Writable } from 'node:stream';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { LOG_REDACT } from '../src/logger';

describe('request logging', () => {
  it('never writes session cookies or auth headers to the logs', async () => {
    const lines: string[] = [];
    const memory = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    // The app's real redaction settings, writing to memory instead of stdout.
    const app = express();
    app.use(pinoHttp({ logger: pino({ redact: LOG_REDACT }, memory) }));
    app.get('/x', (_req, res) => res.cookie('sa_session', 'NEW-TOKEN').send('ok'));

    await request(app).get('/x').set('Cookie', 'sa_session=OLD-TOKEN').set('Authorization', 'Bearer SECRET');

    const log = lines.join('');
    expect(log).toContain('[redacted]');
    for (const secret of ['OLD-TOKEN', 'NEW-TOKEN', 'SECRET']) expect(log).not.toContain(secret);
  });
});
