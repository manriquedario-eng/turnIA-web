/** @type {import('next').NextConfig} */
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
};

export default nextConfig;
