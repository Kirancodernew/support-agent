import mongoose, { type ClientSession } from 'mongoose';

export async function connectDb(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
}

export function disconnectDb() {
  return mongoose.disconnect();
}

/** Runs fn in a MongoDB transaction: every write inside commits together or not at all. */
export function runInTransaction(fn: (session: ClientSession) => Promise<void>) {
  return mongoose.connection.transaction(fn);
}

export const isValidObjectId = (id: unknown): id is string =>
  typeof id === 'string' && mongoose.isValidObjectId(id);

export const toObjectId = (id: string) => new mongoose.Types.ObjectId(id);
