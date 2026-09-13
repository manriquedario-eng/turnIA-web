import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'TurnIA',
  description: 'Gestión profesional de agenda, pacientes y cobros',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
