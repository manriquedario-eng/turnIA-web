import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

export const metadata: Metadata = {
  title: 'TurnIA',
  description: 'Gestión profesional de agenda, pacientes y cobros',
  applicationName: 'TurnIA',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/icons/turnia-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/turnia-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/turnia-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'TurnIA',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
