// Optional accounts (invite-only). Redline works fully without logging in; an account adds cloud backup (and AI later).
import { createClient, type Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Implicit flow: a magic link opened in a different browser (e.g. Safari, from the home-screen app) still works.
    flowType: 'implicit',
  },
});

export async function accessToken(): Promise<string | null> {
  return (await supabase.auth.getSession()).data.session?.access_token ?? null;
}

/** Turn Supabase Auth errors into plain language. */
export function authMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/Database error saving new user|not been invited|Signups not allowed/i.test(m)) return 'That email hasn’t been invited yet.';
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password. If you haven’t set a password, use an email code.';
  if (/expired|invalid/i.test(m) && /token|otp/i.test(m)) return 'That code is wrong or has expired. Send a new one.';
  if (/rate limit|security purposes/i.test(m)) return 'Too many attempts. Wait a minute and try again.';
  return m;
}

export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return { session, loading };
}
