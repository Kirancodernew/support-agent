import type { Metadata } from 'next';
import { WidgetChat } from '@/components/widget-chat';

export const metadata: Metadata = { title: 'Support chat', robots: { index: false } };
export const dynamic = 'force-dynamic';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** The chat shown inside the iframe on a business's website. */
export default async function WidgetPage({ searchParams }: { searchParams: Promise<{ key?: string }> }) {
  const { key = '' } = await searchParams;
  const res = await fetch(`${API_URL}/public/widget-config?key=${encodeURIComponent(key)}`, { cache: 'no-store' }).catch(
    () => null,
  );
  if (!res?.ok) {
    return <p className="widget-error">This chat widget isn&apos;t set up correctly.</p>;
  }
  const { name } = (await res.json()) as { name: string };
  return <WidgetChat publishableKey={key} businessName={name} />;
}
