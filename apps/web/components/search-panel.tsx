'use client';

import { useState, type FormEvent } from 'react';
import { api, type ErrorHandler, type SearchResult } from '@/lib/api';

/** Shows which passages the agent would read for a question. Proves upload + embedding work. */
export function SearchPanel({ onError }: { onError: ErrorHandler }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const query = String(new FormData(e.currentTarget).get('query') ?? '');
    setSearching(true);
    try {
      const res = await api<{ results: SearchResult[] }>('/search', { method: 'POST', body: JSON.stringify({ query }) });
      setResults(res.results);
    } catch (err) {
      onError(err);
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className="card">
      <h2>Test search</h2>
      <p>Ask a question to see which passages from your documents match it best.</p>
      <form onSubmit={search} className="inline-form">
        <input name="query" placeholder="e.g. How do I reset my password?" maxLength={500} required />
        <button type="submit" disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>

      {results && results.length === 0 && (
        <p className="muted">
          No matches. Upload a document first. A document that just turned Ready can take a few seconds
          to become searchable.
        </p>
      )}
      {results && results.length > 0 && (
        <ol className="results">
          {results.map((r) => (
            <li key={`${r.documentId}-${r.position}`}>
              <div className="result-meta">
                <strong>{r.filename}</strong>
                <span className="muted">match {Math.round(r.score * 100)}%</span>
              </div>
              <p>{r.text.length > 400 ? `${r.text.slice(0, 400)}…` : r.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
