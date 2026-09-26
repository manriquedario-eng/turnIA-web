# Alta de profesionales y confirmación de email

TurnIA exige verificación de email antes de crear el tenant de un profesional.

## Flujo

1. El profesional completa `/signup`.
2. Supabase Auth crea el usuario sin sesión y envía el email de confirmación.
3. El usuario confirma el correo.
4. `auth.users.email_confirmed_at` pasa de NULL a un timestamp.
5. El trigger `turnia_provision_confirmed_professional` crea de forma idempotente:
   - `profiles`
   - `tenants`
   - `tenant_members` con role `owner`
6. El callback `/auth/confirm` establece la sesión y dirige al dashboard.

El trigger sólo corre en la transición NULL -> confirmado. Si Confirm Email estuviera desactivado y el alta devolviera una sesión inmediata, la aplicación cierra esa sesión y falla de forma segura.

## Variables de aplicación

- `SIGNUP_ENABLED=true` abre el alta.
- `SIGNUP_ALLOWED_EMAILS` es opcional. Si contiene una lista separada por comas, sólo esos correos pueden registrarse.
- `APP_URL` determina el callback público usado en el alta.

## Supabase Auth requerido

Antes de habilitar `SIGNUP_ENABLED`:

- Allow new users to sign up: ON.
- Confirm Email: ON.
- Configurar Site URL.
- Agregar el callback público a Redirect URLs.
- Configurar Custom SMTP.
- Personalizar Confirm signup para SSR usando el callback de TurnIA.

En la plantilla Confirm signup usar un enlace basado en RedirectTo:

```html
<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Confirmar mi cuenta de TurnIA</a>
```

No habilitar tracking de links en el proveedor SMTP.

## Resend SMTP

La configuración de SMTP de autenticación se realiza en Supabase Auth. No se guardan credenciales SMTP en Git ni en Vercel.

Valores oficiales de Resend:
- host: `smtp.resend.com`
- puerto recomendado: `465`
- usuario: `resend`
- contraseña: una API key de Resend
- remitente: una dirección perteneciente a un dominio verificado en Resend
- nombre del remitente: `TurnIA`

La API key usada como contraseña SMTP debe tratarse como secreto. No se documenta ni se commitea su valor real.

Los emails transaccionales operativos de TurnIA pueden seguir usando la API HTTP de Resend mediante `RESEND_API_KEY`. Los emails de autenticación de Supabase usan Resend vía SMTP; son canales de integración distintos aunque compartan proveedor.

## Producción y beta

Producción y beta deben tener proyectos Supabase distintos y configuración SMTP/Auth propia. La beta reutiliza el mismo código, pero puede restringir altas con `SIGNUP_ALLOWED_EMAILS`.
