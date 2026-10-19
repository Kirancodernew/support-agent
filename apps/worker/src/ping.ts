// Dev check: enqueue a ping job and wait for the running worker to answer.
import { Queue, QueueEvents } from 'bullmq';
import { createRedis, QUEUES, type PingJob, type PingResult } from './queues';

// QueueEvents blocks on Redis while listening, so it needs its own connection.
// BullMQ never closes connections it was handed, so we close both ourselves.
const queueConn = createRedis();
const eventsConn = createRedis();
const queue = new Queue<PingJob, PingResult>(QUEUES.system, { connection: queueConn });
const events = new QueueEvents(QUEUES.system, { connection: eventsConn });

try {
  await events.waitUntilReady();
  const job = await queue.add('ping', { sentAt: Date.now() }, { removeOnComplete: true, removeOnFail: 100 });
  const result = await job.waitUntilFinished(events, 10_000);
  console.log('worker replied:', result);
} catch (err) {
  console.error('no reply from worker (is `npm run dev` running?):', (err as Error).message);
  process.exitCode = 1;
} finally {
  await Promise.all([queue.close(), events.close()]);
  await Promise.all([queueConn.quit(), eventsConn.quit()]);
}
