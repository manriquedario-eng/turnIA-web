'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronRight } from '@/components/ui/icons';

export type ExportFormatId = 'pdf' | 'docx' | 'xlsx';

export type ExportMenuItem = {
  label: string;
  links: { format: ExportFormatId; href: string }[];
};

const FORMAT_LABEL: Record<ExportFormatId, string> = {
  pdf: 'PDF',
  docx: 'Word',
  xlsx: 'Excel',
};

// PARTE 1 del pedido de corrección de UX: el menú "Exportar" quedaba
// recortado cuando el botón vive dentro de un contenedor con
// `overflow: hidden` propio (p. ej. el card del header de
// app/(protected)/patients/[id]/page.tsx, que usa overflow:hidden para
// redondear la franja de stats de abajo). Un position:absolute normal no
// alcanza ahí porque el recorte lo aplica el ANCESTRO, no el propio menú —
// subir el z-index no cambia nada. La solución robusta es sacar el panel
// del flujo del DOM del card por completo: se renderiza con un portal a
// `document.body` y se posiciona con `position: fixed`, calculado a partir
// del rect real del botón. Así el panel nunca puede quedar atrapado por el
// overflow/stacking context de ningún ancestro, sea cual sea.
const MOBILE_BREAKPOINT = 640;
const VIEWPORT_GUTTER = 16; // margen mínimo respecto al borde del viewport (mobile y clamp horizontal)
const TRIGGER_GAP = 6; // separación entre el botón y el panel
const MAX_HEIGHT_RATIO = 0.7; // "max-height: min(70vh, ...)" pedido explícitamente

type FixedPosition = {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight: number;
  widthMode: 'auto' | 'fill';
};

/**
 * Hook compartido entre ExportMenu y SimpleExportMenu: abrir/cerrar,
 * posicionamiento del panel portado a body, cierre por click afuera /
 * Escape / scroll de la página, y recálculo en resize.
 */
function useExportPopover<TTrigger extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<FixedPosition | null>(null);
  const triggerRef = useRef<TTrigger | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const computeInitialPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxHeight = Math.min(viewportHeight * MAX_HEIGHT_RATIO, viewportHeight - VIEWPORT_GUTTER * 2);

    if (viewportWidth <= MOBILE_BREAKPOINT) {
      // Mobile: ancho adaptado al viewport, anclado bajo el botón, sin
      // depender de hover (ya son <button>/<a>, tocables desde el vamos).
      const top = Math.min(rect.bottom + TRIGGER_GAP, viewportHeight - VIEWPORT_GUTTER);
      setPosition({
        top,
        left: VIEWPORT_GUTTER,
        right: VIEWPORT_GUTTER,
        maxHeight: Math.max(120, Math.min(maxHeight, viewportHeight - top - VIEWPORT_GUTTER)),
        widthMode: 'fill',
      });
      return;
    }

    // Desktop: alineado preferentemente al borde derecho del botón. Se
    // ancla con `right` (distancia al borde derecho del viewport) en vez
    // de medir el ancho del panel de antemano — el panel todavía no está
    // en el DOM la primera vez que se abre. El useLayoutEffect de abajo
    // corrige el resultado una vez que el panel ya se puede medir.
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUpwards = spaceBelow < 220 && spaceAbove > spaceBelow;

    setPosition({
      ...(openUpwards
        ? { bottom: viewportHeight - rect.top + TRIGGER_GAP }
        : { top: rect.bottom + TRIGGER_GAP }),
      right: Math.max(VIEWPORT_GUTTER, viewportWidth - rect.right),
      maxHeight: Math.max(120, Math.min(maxHeight, (openUpwards ? spaceAbove : spaceBelow) - TRIGGER_GAP - 8)),
      widthMode: 'auto',
    });
  }, []);

  // Segunda pasada: una vez que el panel ya está montado y se puede medir,
  // corrige si igual se sale por la izquierda (botón muy pegado al borde)
  // — clamp real contra el viewport en vez de asumir un ancho fijo.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const viewportWidth = window.innerWidth;
    if (viewportWidth <= MOBILE_BREAKPOINT) return;

    const rect = trigger.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const rightGap = Math.max(VIEWPORT_GUTTER, viewportWidth - rect.right);
    const leftEdge = viewportWidth - rightGap - panelWidth;
    if (leftEdge < VIEWPORT_GUTTER) {
      setPosition((prev) => (prev ? { ...prev, right: undefined, left: VIEWPORT_GUTTER } : prev));
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        // Se calcula en el mismo tick del click, antes del próximo paint,
        // para que el panel no "salte" de posición al abrirse.
        computeInitialPosition();
      }
      return next;
    });
  }, [computeInitialPosition]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      close();
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    }
    function handleReposition() {
      computeInitialPosition();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    // capture:true — cualquier ancestro puede scrollear, no sólo window.
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open, close, computeInitialPosition]);

  return { open, position, triggerRef, panelRef, toggle, close };
}

function panelStyle(position: FixedPosition | null): CSSProperties {
  if (!position) return { visibility: 'hidden' };
  return {
    position: 'fixed',
    top: position.top,
    bottom: position.bottom,
    left: position.left,
    right: position.right,
    maxHeight: position.maxHeight,
    overflowY: 'auto',
    width: position.widthMode === 'fill' ? `calc(100vw - ${VIEWPORT_GUTTER * 2}px)` : undefined,
  };
}

/**
 * Menú "Exportar" con secciones (ficha de paciente): cada fila es una
 * sección, con un link por formato disponible. El panel se porta a
 * document.body (ver comentario arriba) para no quedar nunca recortado por
 * el card que lo contiene.
 *
 * Feedback: al hacer click se muestra "Generando archivo…" un momento —
 * como la descarga la dispara el propio navegador vía
 * Content-Disposition: attachment (nunca navega fuera de la página), no hay
 * forma de saber exactamente cuándo terminó de descargar; el indicador es
 * heurístico (se apaga solo) en vez de dejar el botón sin ninguna reacción.
 */
export function ExportMenu({ items, buttonLabel = 'Exportar' }: { items: ExportMenuItem[]; buttonLabel?: string }) {
  const [generating, setGenerating] = useState(false);
  const { open, position, triggerRef, panelRef, toggle, close } = useExportPopover<HTMLButtonElement>();

  function handleDownloadClick() {
    setGenerating(true);
    close();
    window.setTimeout(() => setGenerating(false), 2200);
  }

  return (
    <span className="export-menu">
      <button
        type="button"
        ref={triggerRef}
        className="btn secondary export-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {generating ? 'Generando archivo…' : buttonLabel}
        <span aria-hidden="true" className="export-menu-caret">▾</span>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div ref={panelRef} className="export-menu-panel" role="menu" style={panelStyle(position)}>
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
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

/** Variante compacta para un único tipo de contenido (Pacientes, Pagos, Agenda): un solo renglón de formatos, sin la columna de "sección". */
export function SimpleExportMenu({ links, buttonLabel = 'Exportar' }: { links: { format: ExportFormatId; href: string }[]; buttonLabel?: string }) {
  const [generating, setGenerating] = useState(false);
  const { open, position, triggerRef, panelRef, toggle, close } = useExportPopover<HTMLButtonElement>();

  function handleDownloadClick() {
    setGenerating(true);
    close();
    window.setTimeout(() => setGenerating(false), 2200);
  }

  return (
    <span className="export-menu export-menu-simple">
      <button
        type="button"
        ref={triggerRef}
        className="btn secondary export-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {generating ? 'Generando archivo…' : buttonLabel}
        <span aria-hidden="true" className="export-menu-caret">▾</span>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div ref={panelRef} className="export-menu-panel" role="menu" style={panelStyle(position)}>
              {links.map((link) => (
                <a key={link.format} href={link.href} className="export-menu-simple-link" onClick={handleDownloadClick} role="menuitem">
                  {FORMAT_LABEL[link.format]}
                  <IconChevronRight size={14} />
                </a>
              ))}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
