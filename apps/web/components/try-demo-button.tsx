'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** One click into the shared demo workspace: no signup, no password. */
export function TryDemoButton({ className = 'button' }: { className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | string>('idle');

  async function start() {
    setState('loading');
    try {
      await api('/auth/demo', { method: 'POST' });
      router.push('/dashboard');
    } catch (err) {
      setState(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={start} disabled={state === 'loading'}>
        {state === 'loading' ? 'Opening the demo…' : 'Try the live demo'}
      </button>
      {state !== 'idle' && state !== 'loading' && <p className="error">{state}</p>}
    </>
  );
}
