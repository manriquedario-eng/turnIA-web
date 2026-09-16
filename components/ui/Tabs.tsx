'use client';

import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';

export type TabDef = { id: string; label: string };

function tabFromHash(tabs: TabDef[], fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const hash = window.location.hash.replace('#', '');
  return tabs.some((t) => t.id === hash) ? hash : fallback;
}

/**
 * Tabs genéricos, client-side. Cada hijo directo debe tener un prop
 * data-tab="<id>" que coincida con uno de `tabs`; el resto del contenido
 * (fetch de datos, lógica, etc.) sigue resolviéndose en el Server Component
 * padre — este componente sólo decide cuál hijo mostrar.
 *
 * Sincroniza con el hash de la URL (#sesiones, #actividad, etc.) — así un
 * link normal (por ejemplo, una fila de Actividad que dice "ver en
 * Sesiones") puede cambiar de tab sin JS propio, con
 * `href="#sesiones"` dentro de la misma página.
 */
export function Tabs({
  tabs,
  defaultTab,
  children,
}: {
  tabs: TabDef[];
  defaultTab?: string;
  children: ReactNode;
}) {
  const initial = defaultTab ?? tabs[0]?.id;
  const [active, setActive] = useState(initial);

  useEffect(() => {
    setActive(tabFromHash(tabs, initial));
    const onHashChange = () => setActive(tabFromHash(tabs, initial));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = Children.toArray(children);
  const activeChild = items.find(
    (child) => isValidElement(child) && (child.props as { 'data-tab'?: string })['data-tab'] === active,
  );

  return (
    <div>
      <div className="tabs-strip" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`tabs-strip-btn ${active === tab.id ? 'active' : ''}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{activeChild}</div>
    </div>
  );
}
