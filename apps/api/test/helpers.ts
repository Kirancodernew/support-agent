import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import request from 'supertest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createApp } from '../src/app';
import { connectDb, disconnectDb } from '@support-agent/db';
import { createFakes } from './fakes';

/** Starts a throwaway MongoDB (replica set, so transactions work) for the test file. */
export function useTestDb() {
  let mongo: MongoMemoryReplSet;
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await connectDb(mongo.getUri());
    await mongoose.connection.syncIndexes(); // unique email index must exist before the tests run
  });
  afterEach(async () => {
    fakes.reset();
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await disconnectDb();
    await mongo?.stop();
  });
}

export const fakes = createFakes();
export const app = createApp(fakes.deps);

/** A client that keeps cookies between requests, like a browser. */
export const browser = () => request.agent(app);

export async function signedUpBrowser(email = 'owner@acme.test', workspaceName = 'Acme') {
  const agent = browser();
  await agent.post('/auth/signup').send({ email, password: 'correct-horse', workspaceName }).expect(201);
  return agent;
}
