'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, type ErrorHandler } from '@/lib/api';

type Settings = { orderWebhookUrl: string | null; webhookSecret: string | null; notifyEmail: string | null; demoShopAvailable: boolean };

/** Connect the agent to the business: where to look up orders, and who gets ticket emails. */
export function IntegrationsPanel({ onError }: { onError: ErrorHandler }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    api<Settings>('/integrations').then(setSettings).catch(onError);
  }, [onError]);
  if (!settings) return null;

  const update = (next: Settings) => {
    setSettings(next);
    setFormKey((k) => k + 1); // refill the form with what the server saved
  };

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setFieldError(null);
    setSaved(false);
    try {
      update(
        await api<Settings>('/integrations', {
          method: 'PUT',
          body: JSON.stringify({
            orderWebhookUrl: String(form.get('url') ?? '').trim() || null,
            notifyEmail: String(form.get('notify') ?? '').trim() || null,
          }),
        }),
      );
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.details.length) setFieldError(err.details[0]!.message);
      else onError(err);
    }
  }

  async function action(path: string) {
    try {
      update(await api<Settings>(`/integrations/${path}`, { method: 'POST' }));
    } catch (err) {
      onError(err);
    }
  }

  async function test(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setTestResult('Testing…');
    try {
      const res = await api<{ ok: boolean; result?: unknown; error?: string }>('/integrations/test', {
        method: 'POST',
        body: JSON.stringify({ orderId: form.get('orderId'), email: form.get('email') }),
      });
      setTestResult(res.ok ? JSON.stringify(res.result, null, 2) : `Failed: ${res.error}`);
    } catch (err) {
      setTestResult(err instanceof ApiError ? `Failed: ${err.message}` : 'Failed');
    }
  }

  return (
    <section className="card">
      <h2>Integrations</h2>
      <p>
        Let the agent check orders in your own system. We send a signed POST to your endpoint; verify the
        <code> X-Support-Agent-Signature</code> header with your signing secret.
      </p>

      <form key={formKey} onSubmit={save} className="form">
        <label className="field">
          <span>Order lookup endpoint</span>
          <input name="url" defaultValue={settings.orderWebhookUrl ?? ''} placeholder="https://api.yourshop.com/support-agent/orders" aria-invalid={Boolean(fieldError)} />
          {fieldError ? <small className="error">{fieldError}</small> : <small>Must be a public https:// address.</small>}
        </label>
        <label className="field">
          <span>Send ticket and handoff emails to</span>
          <input name="notify" type="email" defaultValue={settings.notifyEmail ?? ''} placeholder="Your account email" />
        </label>
        <div className="actions">
          <button type="submit">Save</button>
          {settings.demoShopAvailable && (
            <button type="button" className="secondary" onClick={() => action('use-demo-shop')}>
              Use demo shop
            </button>
          )}
          {saved && <span className="muted">Saved ✓</span>}
        </div>
      </form>

      {settings.webhookSecret && (
        <div className="key-box">
          <strong>Signing secret</strong>
          <code>{settings.webhookSecret}</code>
          <div className="actions">
            <button className="secondary" onClick={() => action('rotate-secret')}>
              New secret
            </button>
          </div>
        </div>
      )}

      {settings.orderWebhookUrl && (
        <form onSubmit={test} className="inline-form">
          <input name="orderId" placeholder="Order number, e.g. 1001" required />
          <input name="email" type="email" placeholder="Order email" required />
          <button type="submit" className="secondary">
            Test
          </button>
        </form>
      )}
      {settings.orderWebhookUrl?.includes('/demo-shop/') && (
        <small className="muted">Demo shop orders: 1001 and 1002 (demo@acme.example), 1003 and 1004 (priya@acme.example).</small>
      )}
      {testResult && <pre className="test-result">{testResult}</pre>}
    </section>
  );
}
