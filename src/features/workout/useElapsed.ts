import { useEffect, useState } from 'react';

/** Seconds since an ISO timestamp, ticking once a second. */
export function useElapsed(startIso: string | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startIso]);
  return startIso ? Math.max(0, Math.floor((now - Date.parse(startIso)) / 1000)) : 0;
}
