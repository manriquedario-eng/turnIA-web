'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Installation support is progressive enhancement; app usage must not fail
      // if the browser blocks service workers.
    });
  }, []);

  return null;
}
