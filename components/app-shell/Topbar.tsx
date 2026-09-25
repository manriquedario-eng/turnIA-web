'use client';

import { usePathname, useRouter } from 'next/navigation';
import { IconChevronLeft, IconMenu } from '@/components/ui/icons';
import { NAV_SECTIONS } from './nav-items';
import { GlobalSearch } from './GlobalSearch';
import { roleLabel } from '@/lib/identity';

const ALL_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

function titleFor(pathname: string | null) {
  if (!pathname) return 'TurnIA';
  const match = ALL_ITEMS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
  return match?.label ?? 'TurnIA';
}

export function Topbar({
  name,
  role,
  onMenuClick,
}: {
  name: string;
  role: string;
  onMenuClick: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const initials = name.trim().slice(0, 2).toUpperCase();
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
        {pathname !== '/dashboard' ? (
          <button
            type="button"
            className="topbar-back"
            onClick={() => {
              if (window.history.length > 1) router.back();
              else router.push('/dashboard');
            }}
            aria-label="Volver"
            title="Volver"
          >
            <IconChevronLeft />
          </button>
        ) : null}
        <div>
          <div className="topbar-title">{titleFor(pathname)}</div>
          <div className="topbar-date">{today}</div>
        </div>
      </div>

      <GlobalSearch />

      <div className="topbar-profile">
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 600 }}>{name}</div>
          {roleLabel(role) ? <div className="muted" style={{ fontSize: 11 }}>{roleLabel(role)}</div> : null}
        </div>
        <div className="topbar-avatar">{initials}</div>
      </div>
    </header>
  );
}
