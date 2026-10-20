import { Router } from 'express';
import { z } from '@support-agent/config';
import { ConversationModel, toObjectId } from '@support-agent/db';
import { getAuth, requireAuth } from '../auth/require-auth';
import { HttpError } from '../lib/http-error';

/** Days are counted in Indian time, so a 10:30pm chat isn't filed under the next day (UTC). */
export const INSIGHTS_TIMEZONE = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

const rangeSchema = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(30), z.literal(90)])).default(7) });

function parseRange(query: unknown) {
  const parsed = rangeSchema.safeParse(query);
  if (!parsed.success) throw new HttpError(400, 'validation_error', 'days must be 7, 30 or 90');
  return parsed.data.days;
}

/** Messages of this workspace written in [from, to). The updatedAt filter uses the index first. */
const messagesBetween = (workspaceId: string, from: Date, to: Date) => [
  { $match: { workspaceId: toObjectId(workspaceId), updatedAt: { $gte: from } } },
  { $unwind: '$messages' },
  { $match: { 'messages.createdAt': { $gte: from, $lt: to } } },
];

const percentChange = (now: number, before: number) => (before === 0 ? null : Math.round(((now - before) / before) * 100));

/** Every day in the range as YYYY-MM-DD in Indian time, so days with no chats still show as 0. */
function dayKeys(since: Date, days: number) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: INSIGHTS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  return Array.from({ length: days }, (_, i) => fmt.format(new Date(since.getTime() + (i + 1) * DAY_MS)));
}

type Summary = {
  totals: { conversations: number; questions: number }[];
  answers: {
    total: number;
    grounded: number;
    unanswered: number;
    up: number;
    down: number;
    latency: (number | null)[];
  }[];
  daily: { _id: { day: string; channel: string }; questions: number }[];
  topDocuments: { _id: string; citations: number }[];
  actions: { _id: string; count: number }[];
};

// An answer "from the docs" cites a passage ([1]) and wasn't flagged. Retrieval alone doesn't
// count: an off-topic or uncovered question still pulls a related passage it never uses.
const CITED_ANSWER = {
  $and: [
    { $ne: ['$messages.unanswered', true] },
    { $regexMatch: { input: { $ifNull: ['$messages.content', ''] }, regex: '\\[\\d+\\]' } },
  ],
};

/** How the agent is doing: the numbers an owner asks about, for the last 7 / 30 / 90 days. */
export const insightsRouter = Router();
insightsRouter.use(requireAuth);

insightsRouter.get('/summary', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const days = parseRange(req.query);
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const before = new Date(since.getTime() - days * DAY_MS);

  // One pass over the period's messages computes every card at once ($facet).
  const [summary] = await ConversationModel.aggregate<Summary>([
    ...messagesBetween(workspaceId, since, now),
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              conversations: { $addToSet: '$_id' },
              questions: { $sum: { $cond: [{ $eq: ['$messages.role', 'user'] }, 1, 0] } },
            },
          },
          { $project: { _id: 0, conversations: { $size: '$conversations' }, questions: 1 } },
        ],
        answers: [
          { $match: { 'messages.role': 'assistant' } },
          {
            $group: {
              _id: null,
              total: { $sum: 1 },
              grounded: { $sum: { $cond: [CITED_ANSWER, 1, 0] } },
              unanswered: { $sum: { $cond: [{ $eq: ['$messages.unanswered', true] }, 1, 0] } },
              up: { $sum: { $cond: [{ $eq: ['$messages.feedback', 'up'] }, 1, 0] } },
              down: { $sum: { $cond: [{ $eq: ['$messages.feedback', 'down'] }, 1, 0] } },
              // Percentiles, not the average: one 20s answer would hide inside a mean.
              latency: { $percentile: { input: '$messages.firstTokenMs', p: [0.5, 0.95], method: 'approximate' } },
            },
          },
        ],
        daily: [
          { $match: { 'messages.role': 'user' } },
          {
            $group: {
              _id: {
                day: { $dateToString: { date: '$messages.createdAt', format: '%Y-%m-%d', timezone: INSIGHTS_TIMEZONE } },
                channel: '$channel',
              },
              questions: { $sum: 1 },
            },
          },
        ],
        topDocuments: [
          { $match: { $expr: CITED_ANSWER } },
          { $unwind: '$messages.sources' },
          { $group: { _id: '$messages.sources.filename', citations: { $sum: 1 } } },
          { $sort: { citations: -1, _id: 1 } },
          { $limit: 5 },
        ],
        actions: [
          { $unwind: '$messages.actions' },
          // Customer-facing actions only; flag_unanswered is bookkeeping, counted as "unanswered".
          { $match: { 'messages.actions.ok': true, 'messages.actions.tool': { $ne: 'flag_unanswered' } } },
          { $group: { _id: '$messages.actions.tool', count: { $sum: 1 } } },
        ],
      },
    },
  ]);

  // The previous period, only for the "vs last period" change.
  const [previous] = await ConversationModel.aggregate<{ conversations: number; questions: number }>([
    ...messagesBetween(workspaceId, before, since),
    { $match: { 'messages.role': 'user' } },
    { $group: { _id: null, conversations: { $addToSet: '$_id' }, questions: { $sum: 1 } } },
    { $project: { _id: 0, conversations: { $size: '$conversations' }, questions: 1 } },
  ]);

  const totals = summary?.totals[0] ?? { conversations: 0, questions: 0 };
  const answers = summary?.answers[0];
  const rated = (answers?.up ?? 0) + (answers?.down ?? 0);
  const byDay = new Map<string, { widget: number; dashboard: number }>(dayKeys(since, days).map((d) => [d, { widget: 0, dashboard: 0 }]));
  for (const row of summary?.daily ?? []) {
    const day = byDay.get(row._id.day);
    if (day) day[row._id.channel === 'widget' ? 'widget' : 'dashboard'] += row.questions;
  }
  const rate = (n: number | undefined) => (answers?.total ? Math.round(((n ?? 0) / answers.total) * 100) : null);

  res.json({
    days,
    conversations: totals.conversations,
    questions: totals.questions,
    change: {
      conversations: percentChange(totals.conversations, previous?.conversations ?? 0),
      questions: percentChange(totals.questions, previous?.questions ?? 0),
    },
    answers: answers?.total ?? 0,
    answeredFromDocsPct: rate(answers?.grounded),
    unansweredPct: rate(answers?.unanswered),
    satisfaction: { up: answers?.up ?? 0, down: answers?.down ?? 0, pct: rated ? Math.round(((answers?.up ?? 0) / rated) * 100) : null },
    latencyMs: { p50: answers?.latency?.[0] ?? null, p95: answers?.latency?.[1] ?? null },
    daily: [...byDay].map(([day, counts]) => ({ day, ...counts })),
    topDocuments: (summary?.topDocuments ?? []).map((d) => ({ filename: d._id, citations: d.citations })),
    actions: Object.fromEntries((summary?.actions ?? []).map((a) => [a._id, a.count])),
  });
});

// What customers ask that the agent couldn't answer: the list that tells the owner which docs to add.
insightsRouter.get('/unanswered', async (req, res) => {
  const { workspaceId } = getAuth(req);
  const days = parseRange(req.query);
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);

  const rows = await ConversationModel.aggregate<{ _id: string; count: number; lastAsked: Date; example: string; conversationId: unknown }>([
    ...messagesBetween(workspaceId, since, now),
    { $match: { 'messages.unanswered': true } },
    { $sort: { 'messages.createdAt': 1 } },
    {
      $group: {
        _id: '$messages.questionKey',
        count: { $sum: 1 },
        lastAsked: { $max: '$messages.createdAt' },
        example: { $last: '$messages.question' },
        conversationId: { $last: '$_id' },
      },
    },
    { $sort: { count: -1, lastAsked: -1 } },
    { $limit: 20 },
  ]);

  res.json({
    questions: rows.map((r) => ({ question: r.example, count: r.count, lastAsked: r.lastAsked, conversationId: String(r.conversationId) })),
  });
});
