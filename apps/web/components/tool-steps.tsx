import { TOOL_LABELS, type ToolStep } from '@/lib/chat-stream';

/** "Checking order 1001… ✓" lines shown in the chat while the agent uses tools. */
export function ToolSteps({ steps }: { steps?: ToolStep[] }) {
  if (!steps?.length) return null;
  return (
    <ul className="tool-steps">
      {steps.map((s, i) => (
        <li key={i} className={`tool-step ${s.status}`}>
          {s.status === 'running' ? '⏳' : s.status === 'done' ? '✓' : '⚠'} {s.label ?? TOOL_LABELS[s.name] ?? 'Working…'}
        </li>
      ))}
    </ul>
  );
}

/** Adds or updates the step for a tool: "running" starts a line, done/failed finishes the last one. */
export function applyToolStep(steps: ToolStep[] = [], step: ToolStep): ToolStep[] {
  if (step.status === 'running') return [...steps, step];
  const i = steps.findLastIndex((s) => s.name === step.name && s.status === 'running');
  return i === -1 ? [...steps, step] : steps.map((s, j) => (j === i ? step : s));
}
