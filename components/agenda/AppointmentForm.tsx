'use client';

// Envoltorio cliente del form de "Nuevo turno" / "Editar turno" — el resto
// del drawer (app/(protected)/agenda/page.tsx) sigue siendo un Server
// Component; esto SOLO extrae el <form> para poder engancharle estado y un
// guard de doble submit, que requieren 'use client'.
//
// Corrige el BUG 2 reportado: doble click (o Enter mientras el primer
// submit sigue en vuelo) podía disparar la Server Action dos veces. La
// primera creaba el turno (y mandaba el email de confirmación); la segunda,
// unos segundos después, encontraba el turno recién creado como
// "superposición" y era redirigida con error — pero para el usuario parecía
// que "un turno rechazado" había mandado email.
//
// Dos capas de protección, deliberadamente independientes:
// 1. `alreadySubmittedRef` (useRef, síncrono): corta cualquier segundo
//    evento `submit` del form — sea por un segundo click en el botón o por
//    Enter en cualquier campo — ANTES de que llegue a invocar la Server
//    Action de nuevo. No depende de re-render ni de que el estado ya se
//    haya actualizado, por eso es un ref y no sólo el estado `pending`.
// 2. `pending` (useState): sólo para la UI — deshabilita visualmente el
//    botón y cambia su texto a "Guardando…", como refuerzo/feedback, no
//    como el mecanismo que efectivamente bloquea el resubmit.
//
// No se resetea `pending`/`alreadySubmittedRef` a mano: todas las rutas de
// `createAppointment`/`updateAppointment` (éxito o error) terminan en un
// `redirect()`, así que el componente se desmonta/remonta con el
// server-render fresco de la página destino. Si algún día una de esas
// acciones dejara de terminar siempre en redirect, este componente quedaría
// bloqueado tras un error — ese es el único caso a tener en cuenta si se
// toca `actions.ts` más adelante.

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';

export function AppointmentForm({
  action,
  submitLabel,
  cancelHref,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  submitLabel: string;
  cancelHref: string;
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const alreadySubmittedRef = useRef(false);

  return (
    <form
      action={action}
      className="drawer-form"
      onSubmit={(event) => {
        if (alreadySubmittedRef.current) {
          event.preventDefault();
          return;
        }
        alreadySubmittedRef.current = true;
        setPending(true);
      }}
    >
      {children}

      <div className="drawer-footer">
        <button className="btn" type="submit" disabled={pending} aria-disabled={pending} aria-busy={pending}>
          {pending ? 'Guardando…' : submitLabel}
        </button>
        <Link
          className="btn secondary"
          href={cancelHref}
          aria-disabled={pending}
          tabIndex={pending ? -1 : undefined}
          style={pending ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
        >
          Cancelar
        </Link>
      </div>
    </form>
  );
}
