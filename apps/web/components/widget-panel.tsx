'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, type ErrorHandler } from '@/lib/api';

type Settings = { publishableKey: string; allowedOrigins: string[] };

/** Set up the website widget: the snippet to paste, which sites may show it, and a live preview. */
export function WidgetPanel({ onError }: { onError: ErrorHandler }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    api<Settings>('/widget-settings').then(setSettings).catch(onError);
  }, [onError]);

  if (!settings) return null;

  const snippet = `<script src="${window.location.origin}/widget.js" data-key="${settings.publishableKey}" async></script>`;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const lines = String(new FormData(e.currentTarget).get('origins') ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    setSaving(true);
    setSaved(false);
    setFieldError(null);
    try {
      setSettings(await api<Settings>('/widget-settings', { method: 'PUT', body: JSON.stringify({ allowedOrigins: lines }) }));
      setSaved(true);
    } catch (err) {
      const detail = (err as { details?: { message: string }[] }).details?.[0]?.message;
      if (detail) setFieldError(detail);
      else onError(err);
    } finally {
      setSaving(false);
    }
  }

  async function rotate() {
    if (!confirm('Create a new key? The current snippet stops working everywhere until you replace it.')) return;
    try {
      setSettings(await api<Settings>('/widget-settings/rotate-key', { method: 'POST' }));
      setPreviewKey((k) => k + 1);
    } catch (err) {
      onError(err);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
  }

  return (
    <section className="card">
      <h2>Website widget</h2>
      <p>Add this line to your website, just before &lt;/body&gt;. A chat bubble appears for your visitors.</p>
      <div className="key-box">
        <code>{snippet}</code>
        <div className="actions">
          <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy snippet'}</button>
          <button className="secondary" onClick={rotate}>
            New key
          </button>
        </div>
        <small className="muted">
          The key in the snippet is public by design: it only works on the websites listed below.
        </small>
      </div>

      <form onSubmit={save} className="form">
        <label className="field">
          <span>Websites allowed to show the widget (one per line)</span>
          <textarea
            name="origins"
            rows={3}
            defaultValue={settings.allowedOrigins.join('\n')}
            placeholder={'https://www.yourshop.com\nhttps://help.yourshop.com'}
            aria-invalid={Boolean(fieldError)}
          />
          {fieldError ? (
            <small className="error">{fieldError}</small>
          ) : (
            <small>Use full addresses with https://. http://localhost is allowed for testing.</small>
          )}
        </label>
        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save websites'}
          </button>
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </form>

      <h3>Preview</h3>
      <p className="muted">This is what visitors see when they open the chat bubble.</p>
      <iframe
        key={`${settings.publishableKey}-${previewKey}`}
        className="widget-preview"
        src={`/widget?key=${encodeURIComponent(settings.publishableKey)}`}
        title="Widget preview"
      />
    </section>
  );
}
