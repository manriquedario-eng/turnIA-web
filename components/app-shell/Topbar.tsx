'use client';

import { usePathname } from 'next/navigation';
import { IconMenu } from '@/components/ui/icons';
import { NAV_SECTIONS } from './nav-items';
import { GlobalSearch } from './GlobalSearch';

const ALL_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function titleFor(pathname: string | null) {
  if (!pathname) return 'TurnIA';
  const match = ALL_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.label ?? 'TurnIA';
}

export function Topbar({
  email,
  role,
  onMenuClick,
}: {
  email: string;
  role: string;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const initials = email.slice(0, 2).toUpperCase();
  const today = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  return (
    <header className="app-topbar">
      <div className="nav">
        <button type="button" className="menu-toggle" onClick={onMenuClick} aria-label="Abrir menú">
          <IconMenu />
        </button>
        <div>
          <div className="topbar-title">{titleFor(pathname)}</div>
          <div className="topbar-date" style={{ textTransform: 'capitalize' }}>{today}</div>
        </div>
      </div>

      <GlobalSearch />

      <div className="topbar-profile">
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>{email}</div>
          <div className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{role}</div>
        </div>
        <div className="topbar-avatar">{initials}</div>
      </div>
    </header>
  );
}
