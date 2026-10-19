// Render on every request so the status is live, not frozen at build time.
export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

type Health = { status: string; uptimeSeconds: number };

async function getApiHealth(): Promise<Health | null> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as Health) : null;
  } catch {
    return null;
  }
}

export default async function Home() {
  const health = await getApiHealth();

  return (
    <main>
      <h1>Support Agent</h1>
      <p>An AI support agent that answers from your docs and takes actions for your customers.</p>
      <div className="card">
        API status:{' '}
        {health ? (
          <span className="ok">● online (up {health.uptimeSeconds}s)</span>
        ) : (
          <span className="bad">● unreachable</span>
        )}
        <p>
          <code>{API_URL}/health</code>
        </p>
      </div>
    </main>
  );
}
