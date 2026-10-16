import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSession } from '../api/client';

/**
 * Drafts for every add / edit form in the console.
 *
 * A form keeps what has been typed while it is open; close it — on purpose,
 * by a stray Esc, a reload, a dropped session — and reopening it brings the
 * draft back, with a line saying so and a "Discard draft" button. The pattern
 * the onboarding form introduced, made one hook so every form behaves alike.
 *
 *   const d = useFormDraft('lead:new', EMPTY);
 *   <DraftBar draft={d} />
 *   … d.form / d.setForm …
 *   on successful save: d.clear()
 *
 * Kept in localStorage (it survives closing the browser) for 7 days, keyed by
 * the signed-in admin so two people on one computer never see each other's
 * drafts. A form holding something sensitive (a bank account) passes
 * { session: true } and keeps it for this tab only.
 *
 * An edit form passes a key with the record's id AND a `base` (the saved
 * record): a draft older than the record's last change is dropped rather than
 * restored over newer data.
 */
const PREFIX = 'superadmin.draft.';
const TTL = 7 * 24 * 3600 * 1000;

interface Stored<T> { form: T; savedAt: number; baseStamp?: string | null }

function storage(session: boolean): Storage | null {
  try { return session ? window.sessionStorage : window.localStorage; } catch { return null; }
}
const fullKey = (key: string) => `${PREFIX}${loadSession()?.user.id ?? 'anon'}.${key}`;

export interface FormDraft<T> {
  form: T;
  setForm: React.Dispatch<React.SetStateAction<T>>;
  /** When a restored draft was last saved; null when the form started clean. */
  restoredAt: number | null;
  /** When the current contents were last kept. */
  savedAt: number | null;
  /** Throw the draft away and go back to the starting values. */
  discard: () => void;
  /** Forget the draft (call after a successful save). */
  clear: () => void;
  dirty: boolean;
}

export function useFormDraft<T extends object>(
  key: string,
  initial: T,
  opts: { session?: boolean; baseStamp?: string | null } = {},
): FormDraft<T> {
  const store = storage(!!opts.session);
  const k = fullKey(key);
  const [restored] = useState<Stored<T> | null>(() => {
    try {
      const raw = store?.getItem(k);
      if (!raw) return null;
      const s = JSON.parse(raw) as Stored<T>;
      if (Date.now() - s.savedAt > TTL) { store?.removeItem(k); return null; }
      // An edit draft made against an older version of the record is stale.
      if (opts.baseStamp && s.baseStamp && s.baseStamp !== opts.baseStamp) { store?.removeItem(k); return null; }
      return s;
    } catch { return null; }
  });
  const initialRef = useRef(initial);
  const [form, setForm] = useState<T>(() => (restored ? { ...initial, ...restored.form } : initial));
  const [savedAt, setSavedAt] = useState<number | null>(restored?.savedAt ?? null);
  const cleared = useRef(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initialRef.current);

  useEffect(() => {
    if (cleared.current) return;
    const t = setTimeout(() => {
      try {
        if (!dirty) { store?.removeItem(k); setSavedAt(null); return; }
        const now = Date.now();
        store?.setItem(k, JSON.stringify({ form, savedAt: now, baseStamp: opts.baseStamp ?? null }));
        setSavedAt(now);
      } catch { /* storage full or blocked — the form still works */ }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, dirty, k]);

  const clear = useCallback(() => {
    cleared.current = true;
    try { store?.removeItem(k); } catch { /* ignore */ }
  }, [store, k]);
  const discard = useCallback(() => {
    try { store?.removeItem(k); } catch { /* ignore */ }
    setForm(initialRef.current);
    setSavedAt(null);
  }, [store, k]);

  return { form, setForm, restoredAt: restored?.savedAt ?? null, savedAt, discard, clear, dirty };
}

/** True when a draft exists for this form — e.g. to label a button "Continue…". */
export function hasFormDraft(key: string): boolean {
  try { return !!(localStorage.getItem(fullKey(key)) || sessionStorage.getItem(fullKey(key))); } catch { return false; }
}

const time = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** The line at the top of a form: "Picked up your draft from 3:42 pm · Discard draft". */
export function DraftBar<T>({ draft }: { draft: FormDraft<T> }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || !draft.restoredAt) return null;
  return (
    <div className="draft-note" data-testid="draft-restored">
      <span>Picked up your draft from {time(draft.restoredAt)}.</span>
      <button type="button" className="btn sm" onClick={() => {
        if (window.confirm('Discard this draft and start again?')) { draft.discard(); setHidden(true); }
      }}>Discard draft</button>
    </div>
  );
}

/** The small status at the foot of a form: "Draft saved 3:44 pm". */
export function DraftStatus<T>({ draft }: { draft: FormDraft<T> }) {
  return (
    <span className="muted" data-testid="draft-status" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>
      {draft.dirty && draft.savedAt ? `Draft saved ${time(draft.savedAt)} — kept if you close` : 'Drafts are kept if you close'}
    </span>
  );
}
