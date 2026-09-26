import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TurnIA',
    short_name: 'TurnIA',
    description: 'Gestión profesional de agenda, pacientes y cobros',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#f8f6f1',
    theme_color: '#0f766e',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icons/turnia-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/turnia-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
