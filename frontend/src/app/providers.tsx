import type { ReactNode } from 'react';

// Global context providers (auth, settings, realtime) will be composed here.
export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
