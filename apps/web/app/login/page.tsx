import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth-form';

export const metadata: Metadata = { title: 'Log in · Support Agent' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  return <AuthForm mode="login" notice={deleted ? 'Your workspace was deleted.' : undefined} />;
}
