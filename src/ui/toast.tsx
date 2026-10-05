import { Star, TriangleAlert, Check } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';

type Tone = 'info' | 'error' | 'pr' | 'success';
interface ToastState { msg: string | null; tone: Tone; id: number; show: (msg: string, tone?: Tone) => void; clear: () => void }

export const useToast = create<ToastState>((set) => ({
  msg: null,
  tone: 'info',
  id: 0,
  show: (msg, tone = 'info') => set((s) => ({ msg, tone, id: s.id + 1 })),
  clear: () => set({ msg: null }),
}));

export const toast = (msg: string, tone?: Tone) => useToast.getState().show(msg, tone);
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message.replace(/^Error:\s*/, '') : String(e), 'error');

export function Toaster() {
  const { msg, tone, id, clear } = useToast();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(clear, tone === 'error' ? 4000 : 2600);
    return () => clearTimeout(t);
  }, [msg, id, tone, clear]);
  if (!msg) return null;
  return (
    <div className={`toast ${tone}`} role="status" onClick={clear}>
      {tone === 'error' && <TriangleAlert size={18} />}
      {tone === 'pr' && <Star size={18} color="var(--pr)" />}
      {tone === 'success' && <Check size={18} color="var(--success)" />}
      {msg}
    </div>
  );
}
