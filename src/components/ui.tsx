import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiRequestError } from '../api/client';

export function Badge({ value }: { value: string | boolean }) {
  const v = typeof value === 'boolean' ? (value ? 'verified' : 'unverified') : value;
  return <span className={`badge ${v}`}>{typeof value === 'boolean' ? (value ? 'verified' : 'not verified') : v.replace(/_/g, ' ')}</span>;
}

/**
 * A dialog that closes only when asked to.
 *
 * It used to close on any click outside it, and every dialog in this console
 * is a form — so a stray click beside a half-filled onboarding form threw the
 * whole thing away (reported 2026-09-29). Standard for form dialogs (Material's
 * "persistent" dialog, Stripe, Zoho): the backdrop does nothing; the × button
 * and Esc close, and Esc asks first once anything has been typed.
 *
 * `confirmDiscard={false}` for a form that keeps its own draft, where closing
 * loses nothing.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
  confirmDiscard = true,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  confirmDiscard?: boolean;
}) {
  const dirty = useRef(false);
  const requestClose = useCallback(() => {
    if (confirmDiscard && dirty.current && !window.confirm('Close this form? What you have entered will be lost.')) return;
    onClose();
  }, [confirmDiscard, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') requestClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  return (
    <div className="modal-overlay">
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Any typing, ticking or picking inside marks the form as worth
        // protecting — input events bubble from every field type.
        onInput={() => { dirty.current = true; }}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-x" aria-label="Close" title="Close (Esc)" onClick={requestClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Confirmation that a save actually landed.
 *
 * Every form in this console reported failure and said nothing at all on
 * success, so a curator who edited a profile had no way to tell a saved change
 * from a dropped one except by closing the dialog and reopening it. Errors
 * were loud; success was silent.
 */
export function SuccessBox({ message }: { message: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  // Several of these forms live in a dialog taller than the screen, with the
  // Save button at the bottom and this banner at the top — so the first
  // version of this fix rendered a confirmation the user could not see without
  // scrolling back up, which is the same as not confirming at all.
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [message]);
  if (!message) return null;
  return <div ref={ref} className="success-box" role="status">{message}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg =
    error instanceof ApiRequestError
      ? `${error.error.code}: ${error.error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  return <div className="error-box">{msg}</div>;
}

/**
 * Small form harness: submit state, error display, and — since forms that only
 * ever speak up when something breaks leave the user guessing — a confirmation
 * when the save succeeds.
 *
 * `successMessage` defaults to a plain "Saved." Pass `null` to suppress it,
 * which is right for forms that close or navigate away on success and so have
 * nowhere to show it.
 */
export function ActionForm({
  onSubmit,
  submitLabel,
  children,
  onDone,
  successMessage = 'Saved.',
  secondary,
}: {
  onSubmit: () => Promise<void>;
  submitLabel: string;
  children: ReactNode;
  onDone?: () => void;
  successMessage?: string | null;
  /** Extra buttons beside the submit (a Cancel, a Start over). */
  secondary?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The banner clears itself, but a form unmounted by its own onDone (dialog
  // closes, row navigates away) would leave the timer to fire on a dead
  // component — hence the cleanup.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await onSubmit();
      if (successMessage) {
        setOk(successMessage);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setOk(null), 4000);
      }
      onDone?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handle}>
      <ErrorBox error={error} />
      <SuccessBox message={ok} />
      {children}
      <div className="actions">
        {secondary}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/**
 * A short-lived confirmation for actions that finish somewhere the user is no
 * longer looking — creating a record closes its dialog, verifying one just
 * re-renders a row. `SuccessBox` covers forms that stay put; this covers the
 * rest, so no action in the console completes in silence.
 */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function show(text: string, tone: 'ok' | 'bad' = 'ok') {
    setToast({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    // Long enough to read a sentence; a failure gets longer because it may
    // name a reason the user has to act on.
    timer.current = setTimeout(() => setToast(null), tone === 'bad' ? 7000 : 4000);
  }

  const node = toast ? (
    <div
      role="status"
      aria-live="polite"
      className={toast.tone === 'ok' ? 'success-box' : 'error-box'}
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 60, maxWidth: 420, boxShadow: '0 6px 20px rgba(15,23,42,.15)' }}
    >
      {toast.text}
    </div>
  ) : null;

  return { show, node };
}

export function Pagination({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <span className="muted">
        page {page} of {pages} ({total} rows)
      </span>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ‹ Prev
      </button>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next ›
      </button>
    </div>
  );
}
