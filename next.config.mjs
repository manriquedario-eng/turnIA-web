/** @type {import('next').NextConfig} */

// Content-Security-Policy — ver docs/security-headers.md (o el resumen dado
// en el chat) para el detalle de por qué cada origen externo está incluido.
// Resumen rápido de superficie externa real detectada en el repo:
//   - Google Fonts (fonts.googleapis.com / fonts.gstatic.com): <link> en
//     app/layout.tsx, cargado por el BROWSER. Único host externo que el
//     navegador toca directamente.
//   - Supabase (*.supabase.co): sólo se usa desde lib/supabase/server.ts y
//     lib/supabase/service.ts (Server Components / Server Actions / route
//     handlers) — no existe lib/supabase/client.ts ni createBrowserClient en
//     el repo, así que el browser NUNCA habla directo con Supabase. Se
//     incluye igual en connect-src como wildcard *.supabase.co (el nombre
//     exacto del proyecto varía entre NEXT_PUBLIC_SUPABASE_URL de staging y
//     de producción y no se puede hardcodear) sólo como defensa en
//     profundidad, no porque haya un caso de uso confirmado hoy.
//   - Google OAuth/Calendar/Meet (accounts.google.com, oauth2.googleapis.com,
//     www.googleapis.com), Meta WhatsApp Cloud API (graph.facebook.com) y
//     Resend (api.resend.com): las tres son llamadas `fetch` 100% server-side
//     (lib/google/oauth.ts, lib/google/calendar.ts, lib/whatsapp/provider.ts,
//     lib/email/provider.ts) — la CSP del documento HTML no las alcanza ni
//     las necesita en connect-src. La navegación a accounts.google.com para
//     el consentimiento OAuth es un redirect 30x del propio servidor
//     (Response.redirect), no un fetch del browser ni un submit de <form>.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  // 'unsafe-inline' en style-src: Next.js (App Router) y React pueden emitir
  // estilos/inline style attrs en runtime sin que haya forma de cubrirlos con
  // un nonce sin tocar middleware.ts (fuera de alcance de esta pasada, que es
  // sólo next.config.mjs). Sin esto se arriesga romper el render en
  // producción por estilos bloqueados.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // 'unsafe-inline' en script-src: el App Router de Next.js inyecta scripts
  // inline sin nonce para hidratar/streamear el RSC payload
  // (self.__next_f.push(...)). Sin nonce (que requeriría generar uno por
  // request en middleware.ts y no está en el alcance de este cambio),
  // bloquear scripts inline rompe la hidratación de TODA la app. No se
  // agrega 'unsafe-eval'.
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
].join('; ');

const nextConfig = {
  reactStrictMode: true,

  // Sistema de exportación (PDF): @react-pdf/renderer usa pdfkit por debajo,
  // y pdfkit carga sus 14 fuentes estándar (Helvetica, Times, Courier,
  // Symbol, ZapfDingbats y sus variantes bold/oblique/italic) con un
  // require()/import dinámico y sin extensión fija hacia
  // node_modules/pdfkit/js/standard-fonts/*.cjs|.mjs — incluyendo un
  // subdirectorio "chunks/" con nombres hasheados (standardGlyphNames-*.cjs)
  // que esos módulos importan a su vez. El analizador estático de Next
  // (@vercel/nft) no puede seguir ese require dinámico, así que en el
  // deployment serverless de Vercel esos archivos quedan afuera del bundle
  // aunque existan en node_modules — de ahí el
  // "Cannot find module '.../standard-fonts/Helvetica.cjs'" en runtime.
  // outputFileTracingIncludes (estable desde Next 15, ya no bajo
  // `experimental`) fuerza a incluirlos explícitamente en el trace de cada
  // ruta de exportación.
  outputFileTracingIncludes: {
    '/api/export/**': ['./node_modules/pdfkit/js/standard-fonts/**/*'],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          { key: 'Content-Security-Policy', value: CSP_DIRECTIVES },
        ],
      },
    ];
  },
};

export default nextConfig;
