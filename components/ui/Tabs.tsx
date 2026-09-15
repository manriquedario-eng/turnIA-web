'use client';

import { Children, isValidElement, useState, type ReactNode } from 'react';

export type TabDef = { id: string; label: string };

/**
 * Tabs genéricos, client-side. Cada hijo directo debe tener un prop
 * data-tab="<id>" que coincida con uno de `tabs`; el resto del contenido
 * (fetch de datos, lógica, etc.) sigue resolviéndose en el Server Component
 * padre — este componente sólo decide cuál hijo mostrar.
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
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
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
