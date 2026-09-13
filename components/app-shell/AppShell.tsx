'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { MobileTabbar } from './MobileTabbar';

export function AppShell({
  email,
  role,
  logoutAction,
  children,
}: {
  email: string;
  role: string;
  logoutAction: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        logoutAction={logoutAction}
        email={email}
        role={role}
      />
      <div className="app-main">
        <Topbar email={email} role={role} onMenuClick={() => setMobileOpen(true)} />
        <main className="app-content">
          <div className="container">{children}</div>
        </main>
        <MobileTabbar />
      </div>
    </div>
  );
}
