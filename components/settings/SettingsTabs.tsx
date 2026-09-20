'use client';

import { useEffect, useState, type ReactNode } from 'react';

const TAB_IDS = ['preferencias', 'integraciones'] as const;
type TabId = (typeof TAB_IDS)[number];

function tabFromHash(): TabId {
  if (typeof window === 'undefined') return 'preferencias';
  const hash = window.location.hash.replace('#', '');
  return (TAB_IDS as readonly string[]).includes(hash) ? (hash as TabId) : 'preferencias';
}

/**
 * Antes, "Integraciones" en Configuración era un simple link ancla
 * (`/settings#integraciones`) que hacía scroll a una sección — pero las dos
 * secciones (Preferencias e Integraciones) estaban SIEMPRE ambas visibles,
 * y el tab "Preferencias" tenía la clase "active" escrita a mano, siempre.
 * Resultado: la tab "Integraciones" nunca se veía realmente activa ni
 * ocultaba Preferencias. Esto reemplaza eso por tabs reales: sólo un panel
 * visible a la vez, el hash controla cuál (no sólo hace scroll), y el link
 * "Servicios" sigue siendo una navegación real a /services (esa pantalla
 * ya funciona bien y no se toca).
 */
export function SettingsTabs({
  preferencias,
  integraciones,
}: {
  preferencias: ReactNode;
  integraciones: ReactNode;
}) {
  const [active, setActive] = useState<TabId>('preferencias');

  useEffect(() => {
    setActive(tabFromHash());
    const onHashChange = () => setActive(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  function go(tab: TabId) {
    setActive(tab);
    window.history.replaceState(null, '', tab === 'preferencias' ? '/settings' : `/settings#${tab}`);
  }

  return (
    <>
      <div className="section-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={active === 'preferencias'} className={active === 'preferencias' ? 'active' : ''} onClick={() => go('preferencias')}>
          Preferencias
        </button>
        <button type="button" role="tab" aria-selected={active === 'integraciones'} className={active === 'integraciones' ? 'active' : ''} onClick={() => go('integraciones')}>
          Integraciones
        </button>
        <a href="/services">Servicios</a>
      </div>

      <div role="tabpanel" hidden={active !== 'preferencias'}>{preferencias}</div>
      <div role="tabpanel" hidden={active !== 'integraciones'}>{integraciones}</div>
    </>
  );
}
