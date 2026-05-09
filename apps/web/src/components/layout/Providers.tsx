'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';
import { ToastContainer } from '@/components/ui/ToastContainer';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <ToastContainer />
    </SessionProvider>
  );
}
