import { useQuery } from '@tanstack/react-query';
import { Cloud, CloudOff, DownloadCloud, KeyRound, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authMessage, supabase, useSession } from '../../auth/auth';
import { db } from '../../db/client';
import { relativeDays } from '../../shared/time';
import { logOut, restoreFromCloud, syncNow } from '../../sync/sync';
import { Term } from '../../ui/InfoTip';
import { Badge, Button, Field, ListRow } from '../../ui/primitives';
import { ConfirmSheet, Sheet } from '../../ui/Sheet';
import { toast, toastError } from '../../ui/toast';

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return relativeDays(iso);
}

/** Account + cloud backup. Logged out, Redline is local-only. */
export function CloudSection() {
  const nav = useNavigate();
  const { session } = useSession();
  const { data } = useQuery({
    queryKey: ['sync', !!session],
    queryFn: async () => ({ state: await db.getSyncState(), pending: await db.pendingSyncCount() }),
    refetchInterval: 30_000,
  });
  const [busy, setBusy] = useState<null | 'sync' | 'restore' | 'password'>(null);
  const [sheet, setSheet] = useState<null | 'restore' | 'logout' | 'password'>(null);
  const [password, setPassword] = useState('');

  const run = async <T,>(kind: 'sync' | 'restore' | 'password', fn: () => Promise<T>, ok: (v: T) => string) => {
    setBusy(kind);
    try { toast(ok(await fn()), 'success'); } catch (e) { toastError(new Error(authMessage(e))); } finally { setBusy(null); }
  };

  if (!session) {
    return (
      <div className="section">
        <div className="section-label"><Term k="cloud" micro>Account</Term><Badge tone="neutral" icon={<CloudOff />}>Local only</Badge></div>
        <div className="list">
          <ListRow title="Log in" sub="Invite-only. Adds cloud backup and sync. Everything works without it." leading={<LogIn size={20} className="red" />} onClick={() => nav('/login')} />
        </div>
      </div>
    );
  }

  const state = data?.state;
  const pending = data?.pending ?? 0;
  const status = state?.last_error
    ? <Badge tone="warning">Sync error</Badge>
    : pending > 0 ? <Badge tone="info">{`${pending} pending`}</Badge> : <Badge tone="success" icon={<Cloud />}>Synced</Badge>;

  return (
    <div className="section">
      <div className="section-label"><Term k="cloud" micro>Account</Term>{status}</div>
      <div className="list">
        <ListRow title={session.user.email ?? 'Signed in'}
          sub={state?.last_error ?? (state?.last_synced_at ? `Last synced ${ago(state.last_synced_at)}${pending ? ` · ${pending} changes waiting` : ''}` : 'Not synced yet')} />
        <ListRow title={busy === 'sync' ? 'Syncing…' : 'Sync now'} leading={<RefreshCw size={20} className="red" />}
          onClick={() => !busy && void run('sync', syncNow, (n) => (n ? `Pushed ${n} changes` : 'Up to date'))} />
        <ListRow title={busy === 'restore' ? 'Restoring…' : 'Restore from cloud'} sub="Merge the cloud copy into this device" leading={<DownloadCloud size={20} className="red" />}
          onClick={() => !busy && setSheet('restore')} />
        <ListRow title="Set password" sub="Optional. Log in without an email code." leading={<KeyRound size={20} className="red" />} onClick={() => { setPassword(''); setSheet('password'); }} />
        <ListRow title="Log out" leading={<LogOut size={20} className="red" />} onClick={() => setSheet('logout')} />
      </div>

      <ConfirmSheet open={sheet === 'restore'} onClose={() => setSheet(null)} title="Restore from cloud?" confirmLabel="Restore"
        body="Anything newer on this phone is kept; everything else comes from the cloud copy."
        onConfirm={() => void run('restore', () => restoreFromCloud('merge'), (n) => `Restored ${n} records`)} />

      <Sheet open={sheet === 'password'} onClose={() => setSheet(null)} title="Set password">
        <Field label="New password" hint="At least 8 characters.">
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Button block style={{ marginTop: 16 }} disabled={password.length < 8 || busy === 'password'}
          onClick={() => void run('password', async () => {
            const { error } = await supabase.auth.updateUser({ password });
            if (error) throw error;
            setSheet(null);
          }, () => 'Password set')}>Save password</Button>
      </Sheet>

      <Sheet open={sheet === 'logout'} onClose={() => setSheet(null)} title="Log out">
        <p className="callout muted">Your data is backed up to your account. Choose what happens to the copy on this device.</p>
        <div className="stack-sm" style={{ marginTop: 16 }}>
          <Button block variant="secondary" onClick={() => { setSheet(null); void logOut(false).then(() => toast('Logged out · data kept on this device')).catch(toastError); }}>
            Log out, keep data here
          </Button>
          <Button block variant="destructive" onClick={() => { setSheet(null); void logOut(true).then(() => nav('/onboarding', { replace: true })).catch(toastError); }}>
            Log out and remove data from this device
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
