'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/insights', label: 'Insights' },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="app-nav" aria-label="Main">
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={pathname === l.href ? 'active' : ''} aria-current={pathname === l.href ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
