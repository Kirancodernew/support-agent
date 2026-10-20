'use client';

import { useState } from 'react';

type Value = 'up' | 'down' | null;

/** 👍 / 👎 under an answer. Clicking the chosen one again clears it. */
export function FeedbackButtons({ onRate }: { onRate: (value: Value) => Promise<void> }) {
  const [value, setValue] = useState<Value>(null);
  const [failed, setFailed] = useState(false);

  async function choose(next: 'up' | 'down') {
    const target = value === next ? null : next;
    const previous = value;
    setValue(target); // optimistic: feels instant
    setFailed(false);
    try {
      await onRate(target);
    } catch {
      setValue(previous);
      setFailed(true);
    }
  }

  return (
    <div className="feedback" role="group" aria-label="Rate this answer">
      <button className={value === 'up' ? 'on' : ''} aria-pressed={value === 'up'} aria-label="Helpful" onClick={() => choose('up')}>
        👍
      </button>
      <button className={value === 'down' ? 'on' : ''} aria-pressed={value === 'down'} aria-label="Not helpful" onClick={() => choose('down')}>
        👎
      </button>
      {failed && <small className="error">Couldn&apos;t save</small>}
    </div>
  );
}
