import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authMessage, supabase, useSession } from '../../auth/auth';
import { afterLogin } from '../../sync/sync';
import { Button, Field, Segmented } from '../../ui/primitives';
import { PushScreen } from '../../ui/Screen';
import { toast } from '../../ui/toast';

type Mode = 'code' | 'password';

export function LoginScreen() {
  const nav = useNavigate();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<Mode>('code');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Signed in (including arriving from a magic link): bring this device in line with the account, then go home.
  useEffect(() => {
    if (!session || syncing) return;
    setSyncing(true);
    void afterLogin()
      .then(({ pulled }) => toast(pulled ? `Logged in · restored ${pulled} records` : 'Logged in · cloud backup on', 'success'))
      .catch((e) => toast(`Logged in, but sync failed: ${authMessage(e)}`, 'error'))
      .finally(() => nav('/', { replace: true }));
  }, [session, syncing, nav]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(authMessage(e)); } finally { setBusy(false); }
  };

  const sendCode = () => run(async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, emailRedirectTo: `${location.origin}/login` },
    });
    if (error) throw error;
    setSent(true);
  });

  const verify = () => run(async () => {
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    if (error) throw error;
  });

  const signIn = () => run(async () => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw error;
  });

  if (loading || session) {
    return <PushScreen title="Log in" back={false}><p className="muted center" style={{ marginTop: 48 }}>{session ? 'Syncing your data…' : ''}</p></PushScreen>;
  }

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());

  return (
    <PushScreen title="Log in" back={() => nav('/', { replace: true })} backLabel="Redline">
      <div className="wordmark" style={{ fontSize: 40, marginTop: 8 }}>RED<span>LINE</span></div>
      <p className="muted" style={{ margin: '12px 0 24px' }}>
        Redline works without an account. Logging in adds cloud backup and sync across devices. Accounts are invite-only.
      </p>

      <Segmented value={mode} onChange={(m) => { setMode(m); setError(null); }}
        options={[{ value: 'code', label: 'Email code' }, { value: 'password', label: 'Password' }]} />

      <div style={{ marginTop: 16 }}>
        <Field label="Email">
          <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" value={email}
            onChange={(e) => { setEmail(e.target.value); setSent(false); }} disabled={sent && mode === 'code'} />
        </Field>

        {mode === 'code' && !sent && (
          <Button block style={{ marginTop: 16 }} disabled={!validEmail || busy} onClick={() => void sendCode()}>{busy ? 'Sending…' : 'Email me a code'}</Button>
        )}
        {mode === 'code' && sent && (
          <>
            <Field label="6-digit code" hint="Check your email. On a computer you can also tap the link in it.">
              <input className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus
                style={{ fontFamily: 'var(--font-num)', fontSize: 28, letterSpacing: '0.3em', textAlign: 'center' }} />
            </Field>
            <Button block style={{ marginTop: 16 }} disabled={code.length !== 6 || busy} onClick={() => void verify()}>{busy ? 'Checking…' : 'Log in'}</Button>
            <Button variant="ghost" block style={{ marginTop: 4 }} onClick={() => { setSent(false); setCode(''); }}>Use a different email</Button>
          </>
        )}

        {mode === 'password' && (
          <>
            <Field label="Password">
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && validEmail && password && void signIn()} />
            </Field>
            <Button block style={{ marginTop: 16 }} disabled={!validEmail || !password || busy} onClick={() => void signIn()}>{busy ? 'Logging in…' : 'Log in'}</Button>
            <p className="caption center" style={{ marginTop: 12 }}>No password yet? Log in with an email code, then set one in Settings.</p>
          </>
        )}

        {error && <div className="banner" role="alert" style={{ marginTop: 16 }}>{error}</div>}
      </div>
    </PushScreen>
  );
}
