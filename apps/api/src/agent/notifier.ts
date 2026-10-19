/** Tells the business's team about new inbox items (tickets, call-backs, handoffs). */
export interface Notifier {
  notify(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Sends real email through Resend's HTTP API. */
export function createResendNotifier({ apiKey, from }: { apiKey: string; from: string }): Notifier {
  return {
    async notify({ to, subject, text }) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

/** Used when no email provider is configured: the item still lands in the dashboard Inbox. */
export const noopNotifier: Notifier = { notify: async () => undefined };
