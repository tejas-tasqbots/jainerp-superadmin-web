import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiRequestError } from '../api/client';

export function Badge({ value }: { value: string | boolean }) {
  const v = typeof value === 'boolean' ? (value ? 'verified' : 'unverified') : value;
  return <span className={`badge ${v}`}>{typeof value === 'boolean' ? (value ? 'verified' : 'not verified') : v.replace(/_/g, ' ')}</span>;
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
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

/** Small form harness: handles submit state + error display. */
export function ActionForm({
  onSubmit,
  submitLabel,
  children,
  onDone,
}: {
  onSubmit: () => Promise<void>;
  submitLabel: string;
  children: ReactNode;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function handle(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
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
      {children}
      <div className="actions">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Working…' : submitLabel}
        </button>
      </div>
    </form>
  );
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
