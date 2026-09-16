'use client';

import { useRef, useState } from 'react';
import { IconChevronRight } from '@/components/ui/icons';

export type ExportMenuItem = {
  label: string;
  links: { format: 'pdf' | 'docx' | 'xlsx'; href: string }[];
};

const FORMAT_LABEL: Record<'pdf' | 'docx' | 'xlsx', string> = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
};

/**
 * Menú "Exportar" (PARTE 15 del pedido de exportación): popover simple con
 * <details>/<summary> — sin pantalla nueva, funciona con click/tap sin
 * depender de hover, y cada link es una descarga autenticada real (GET a
 * /api/export/..., detrás de la sesión de TurnIA — no hay JS armando el
 * archivo en el cliente).
 *
 * Feedback (PARTE 16): al hacer click se muestra "Generando archivo…" un
 * momento — como la descarga la dispara el propio navegador vía
 * Content-Disposition: attachment (nunca navega fuera de la página), no hay
 * forma de saber exactamente cuándo terminó de descargar; el indicador es
 * heurístico (se apaga solo) en vez de dejar el botón sin ninguna reacción.
 */
export function ExportMenu({ items, buttonLabel = 'Exportar' }: { items: ExportMenuItem[]; buttonLabel?: string }) {
  const [generating, setGenerating] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleDownloadClick() {
    setGenerating(true);
    if (detailsRef.current) detailsRef.current.open = false;
    window.setTimeout(() => setGenerating(false), 2200);
  }

  return (
    <details className="export-menu" ref={detailsRef}>
      <summary className="btn secondary export-menu-trigger" role="button">
        {generating ? 'Generando archivo…' : buttonLabel}
        <span aria-hidden="true" className="export-menu-caret">▾</span>
      </summary>
      <div className="export-menu-panel" role="menu">
        {items.map((item) => (
          <div key={item.label} className="export-menu-row">
            <span className="export-menu-row-label">{item.label}</span>
            <span className="export-menu-row-formats">
              {item.links.map((link) => (
                <a key={link.format} href={link.href} className="export-menu-format-link" onClick={handleDownloadClick} role="menuitem">
                  {FORMAT_LABEL[link.format]}
                </a>
              ))}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Variante compacta para un único tipo de contenido (Pacientes, Pagos, Agenda): un solo renglón de formatos, sin la columna de "sección". */
export function SimpleExportMenu({ links, buttonLabel = 'Exportar' }: { links: { format: 'pdf' | 'docx' | 'xlsx'; href: string }[]; buttonLabel?: string }) {
  const [generating, setGenerating] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function handleDownloadClick() {
    setGenerating(true);
    if (detailsRef.current) detailsRef.current.open = false;
    window.setTimeout(() => setGenerating(false), 2200);
  }

  return (
    <details className="export-menu export-menu-simple" ref={detailsRef}>
      <summary className="btn secondary export-menu-trigger" role="button">
        {generating ? 'Generando archivo…' : buttonLabel}
        <span aria-hidden="true" className="export-menu-caret">▾</span>
      </summary>
      <div className="export-menu-panel" role="menu">
        {links.map((link) => (
          <a key={link.format} href={link.href} className="export-menu-simple-link" onClick={handleDownloadClick} role="menuitem">
            {FORMAT_LABEL[link.format]}
            <IconChevronRight size={14} />
          </a>
        ))}
      </div>
    </details>
  );
}
