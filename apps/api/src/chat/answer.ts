import type { Request, Response } from 'express';
import { ConversationModel, DocumentModel, newObjectId } from '@support-agent/db';
import type { ChatTurn, ToolCall } from '@support-agent/llm';
import { executeTool, FLAG_UNANSWERED, isInternalTool, TOOL_DECLARATIONS, type ToolContext } from '../agent/tools';
import type { AppDeps } from '../deps';
import { buildSystemPrompt, buildUserTurn, GIVE_UP_ANSWER, HISTORY_MESSAGES, normalizeQuestion, retrievalQuery } from './prompt';

const TOP_K = 5;
/** Most model↔tool round trips per message: a confused model can't loop (or spend) forever. */
export const MAX_AGENT_STEPS = 4;

type ConversationDoc = InstanceType<typeof ConversationModel>;

/** One Server-Sent Event: an event name and a JSON payload, ended by a blank line. */
const sendEvent = (res: Response, event: string, data: unknown) =>
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

/**
 * The agent's answer, shared by the dashboard chat and the website widget:
 * retrieve this workspace's passages → let the model answer and/or use tools (guarded loop)
 * → stream text and tool status as SSE → save both messages.
 * The caller has already authenticated, rate-limited and loaded (or created) the conversation.
 */
export async function streamAnswer(
  { llm, retriever, chat, orders, notifier }: Pick<AppDeps, 'llm' | 'retriever' | 'chat' | 'orders' | 'notifier'>,
  {
    req,
    res,
    workspace,
    conversation,
    message,
  }: {
    req: Request;
    res: Response;
    workspace: ToolContext['workspace'];
    conversation: ConversationDoc;
    message: string;
  },
) {
  const history: ChatTurn[] = conversation.messages
    .slice(-HISTORY_MESSAGES)
    .map((m) => (m.role === 'user' ? { role: 'user', text: m.content } : { role: 'assistant', text: m.content }));

  // Retrieve: embed the question, find the closest passages in this workspace only.
  const [vector] = await llm.embed([retrievalQuery(history, message)], 'query');
  if (!vector) throw new Error('embedding returned no vector');
  const hits = await retriever.search(workspace.id, vector, TOP_K);
  const docs = await DocumentModel.find(
    { _id: { $in: hits.map((h) => h.documentId) }, workspaceId: workspace.id },
    { filename: 1 },
  );
  const filenames = new Map(docs.map((d) => [String(d._id), d.filename]));
  // Weak matches are dropped so the model isn't tempted to answer from unrelated text.
  const sources = hits
    .filter((h) => filenames.has(h.documentId) && h.score >= chat.minScore)
    .map((h, i) => ({ n: i + 1, ...h, filename: filenames.get(h.documentId)! }));
  const citedSources = sources.map(({ n, documentId, filename, position, score }) => ({ n, documentId, filename, position, score }));

  conversation.messages.push({ role: 'user', content: message });
  await conversation.save();

  // From here the response is a stream: the status is sent, so failures become an "error" event.
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tells proxies not to buffer the stream
  });
  res.flushHeaders();
  sendEvent(res, 'meta', { conversationId: String(conversation._id), sources: citedSources });

  // If the user leaves mid-answer, stop generating (and paying for) the rest.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  const started = Date.now();
  let firstTokenMs: number | undefined;
  let answer = '';
  const actions: { tool: string; ok: boolean }[] = [];
  const say = (text: string) => {
    firstTokenMs ??= Date.now() - started;
    answer += text;
    sendEvent(res, 'token', { text });
  };
  // Known up front so the client can attach 👍/👎 to this exact answer.
  const answerId = newObjectId();
  const saveAnswer = (extra: { totalMs?: number; interrupted?: boolean }) =>
    ConversationModel.updateOne(
      { _id: conversation._id },
      {
        $push: {
          messages: {
            _id: answerId,
            role: 'assistant',
            question: message,
            questionKey: normalizeQuestion(message),
            // The agent said it couldn't answer, or it had nothing to go on at all.
            unanswered:
              actions.some((a) => a.tool === FLAG_UNANSWERED) ||
              (sources.length === 0 && !actions.some((a) => a.ok && a.tool !== FLAG_UNANSWERED)),
            content: answer || '…',
            sources: citedSources.map(({ n: _n, ...s }) => s),
            actions: actions.length ? actions : undefined,
            firstTokenMs,
            ...extra,
          },
        },
      },
    );

  const ctx: ToolContext = { workspace, conversation, orders, notifier, log: req.log };
  const turns: ChatTurn[] = [...history, { role: 'user', text: buildUserTurn(message, sources) }];

  try {
    let finished = false;
    for (let step = 0; step < MAX_AGENT_STEPS && !finished; step++) {
      const calls: ToolCall[] = [];
      let stepText = '';
      let providerParts: unknown;
      for await (const event of llm.generateStream({
        system: buildSystemPrompt(workspace.name),
        turns,
        tools: TOOL_DECLARATIONS,
        signal: abort.signal,
      })) {
        if (event.type === 'text') {
          stepText += event.text;
          say(event.text);
        } else if (event.type === 'toolCall') {
          calls.push(event.call);
        } else {
          providerParts = event.providerParts;
        }
      }
      if (calls.length === 0) {
        finished = true;
        break;
      }

      // The model asked for tools: run each (our code decides), then hand the results back.
      turns.push({ role: 'assistant', text: stepText, toolCalls: calls, providerParts });
      const results = [];
      for (const call of calls) {
        const visible = !isInternalTool(call.name); // bookkeeping tools get no status line
        if (visible) sendEvent(res, 'tool', { name: call.name, status: 'running' });
        const outcome = await executeTool(call, ctx);
        if (visible) sendEvent(res, 'tool', { name: call.name, status: outcome.ok ? 'done' : 'failed', label: outcome.label });
        actions.push({ tool: call.name, ok: outcome.ok });
        results.push({ id: call.id, name: call.name, result: outcome.result });
      }
      turns.push({ role: 'tool', results });
      if (stepText) say('\n\n');
    }
    if (!finished) say(GIVE_UP_ANSWER);

    const totalMs = Date.now() - started;
    await saveAnswer({ totalMs });
    req.log.info({ firstTokenMs, totalMs, sources: sources.length, actions, channel: conversation.channel }, 'chat answered');
    sendEvent(res, 'done', { firstTokenMs, totalMs, messageId: String(answerId) });
  } catch (err) {
    if (abort.signal.aborted) {
      if (answer) await saveAnswer({ interrupted: true }).catch(() => undefined);
      return;
    }
    req.log.error({ err }, 'chat failed');
    sendEvent(res, 'error', { message: 'The assistant is unavailable right now. Please try again.' });
  } finally {
    res.end();
  }
}
