import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUpload, ApiRequestError } from '../api/client';
import { Badge, ErrorBox, Modal, Pagination, useToast } from '../components/ui';

/**
 * The granth library — the only place books enter it.
 *
 * ── WHAT THE MIRROR NUMBER MEANS ────────────────────────────────────────────
 * The catalogue was scraped from digjainwiki as metadata: 4,498 rows whose
 * files sat on somebody else's Google Drive. Migrations 075/076 move those
 * files onto our own origin, book by book, and until that finishes the library
 * holds two kinds of row — mirrored ones a devotee reads inside the app, and
 * un-mirrored ones that still send them to the source. The headline count is
 * how far that has got, and it is what says when the source fallback can
 * finally be deleted from the apps.
 *
 * ── WHY UPLOAD LIVES HERE AND NOT IN A TENANT CONSOLE ───────────────────────
 * The library is platform content. No temple owns it, so no temple admin
 * curates it — the same reasoning that has kept sant profiles superadmin-only
 * since migration 044.
 */

interface GranthRow {
  id: string;
  title: string;
  title_hi: string | null;
  author: string | null;
  language: string | null;
  shelf: string | null;
  source: string | null;
  file_name: string;
  sant_relation: 'by' | 'about' | null;
  verified: boolean;
  mirror_path: string | null;
  sha256: string | null;
  file_bytes: string | number | null;
  mirrored_at: string | null;
}

interface LibraryStats {
  total: number;
  mirrored: number;
  uploaded: number;
  distinct_objects: number;
  bytes: string | number;
  bucket: string | null;
  origin_configured: boolean;
}

const PAGE_SIZE = 25;

function humanBytes(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!n) return '—';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function LibraryPage() {
  const [rows, setRows] = useState<GranthRow[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [mirroredFilter, setMirroredFilter] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [showUpload, setShowUpload] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (q) params.set('q', q);
    if (mirroredFilter) params.set('mirrored', mirroredFilter);
    api<GranthRow[]>(`/admin/granths?${params}`)
      .then((r) => {
        setRows(r.data ?? []);
        setTotal(r.meta?.total ?? 0);
      })
      .catch(setError);
    api<LibraryStats>('/admin/granths/stats')
      .then((r) => setStats(r.data))
      .catch(() => { /* the table is still useful without the banner */ });
  }, [page, q, mirroredFilter]);
  useEffect(load, [load]);

  const pending = stats ? stats.total - stats.mirrored : 0;

  return (
    <div>
      {toast.node}
      <h1>Library</h1>
      <ErrorBox error={error} />

      {stats && !stats.origin_configured && (
        <div style={{
          margin: '0 0 16px', padding: 12, borderRadius: 8,
          background: '#fef2f2', border: '1px solid #fecaca',
        }}>
          <strong style={{ fontSize: 13 }}>No storage bucket is configured</strong>
          <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
            Set <code>GRANTH_BUCKET</code> on this API before uploading. Until then books can be
            catalogued but not stored, and every granth keeps opening at its original source.
          </p>
        </div>
      )}

      {stats && (
        <div style={{ display: 'flex', gap: 1, margin: '0 0 16px', flexWrap: 'wrap' }}>
          <Stat label="Books" value={stats.total.toLocaleString('en-IN')} />
          <Stat
            label="On our origin"
            value={`${stats.mirrored.toLocaleString('en-IN')}`}
            hint={pending > 0 ? `${pending.toLocaleString('en-IN')} still open at the source` : 'complete'}
          />
          <Stat label="Stored files" value={stats.distinct_objects.toLocaleString('en-IN')}
            hint={`${(stats.mirrored - stats.distinct_objects).toLocaleString('en-IN')} duplicate scans share a file`} />
          <Stat label="Footprint" value={humanBytes(stats.bytes)} />
          <Stat label="Uploaded here" value={stats.uploaded.toLocaleString('en-IN')} />
        </div>
      )}

      <div className="toolbar">
        <input
          placeholder="Search title (either script), author or filename…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select
          value={mirroredFilter}
          onChange={(e) => { setMirroredFilter(e.target.value); setPage(1); }}
        >
          <option value="">All books</option>
          <option value="true">On our origin</option>
          <option value="false">Still at the source</option>
        </select>
        <div className="grow" />
        <button className="btn primary" onClick={() => setShowUpload(true)}>+ Upload book</button>
      </div>

      <table className="data">
        <thead>
          <tr>
            <th>Title</th><th>Author</th><th>Shelf</th>
            <th>Size</th><th>Where it lives</th><th>Added</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td>
                {g.title}
                {g.title_hi && (
                  <div className="muted" style={{ fontSize: 11 }}>{g.title_hi}</div>
                )}
                {/* A book ABOUT an ascetic must never read as a book BY them —
                    the same rule the devotee shelf enforces. */}
                {g.sant_relation === 'about' && (
                  <div style={{ fontSize: 11, color: '#b45309' }}>about an ascetic, not by them</div>
                )}
              </td>
              <td>{g.author || <span className="muted">—</span>}</td>
              <td>{g.shelf || <span className="muted">—</span>}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{humanBytes(g.file_bytes)}</td>
              <td>
                {g.mirror_path
                  ? <Badge value="our origin" />
                  : <span className="muted" style={{ fontSize: 12 }}>source site</span>}
                {!g.verified && (
                  <div style={{ fontSize: 11, color: '#b45309' }}>unpublished</div>
                )}
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                {g.source === 'upload' ? 'uploaded here' : g.source || '—'}
              </td>
            </tr>
          ))}
          {!rows.length && (
            <tr><td colSpan={6} className="muted">No books match.</td></tr>
          )}
        </tbody>
      </table>

      <Pagination page={page} total={total} limit={PAGE_SIZE} onPage={setPage} />

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onDone={(title) => {
            setShowUpload(false);
            toast.show(`"${title}" added to the library`);
            load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{
      flex: '1 1 150px', padding: '10px 14px',
      background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8,
    }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

/**
 * Add one book.
 *
 * The title is pre-filled from the filename because the source's whole
 * collection is named that way and a curator uploading a batch would otherwise
 * retype what is already on screen. It stays editable — the guess is a
 * convenience, not a claim.
 */
function UploadModal({ onClose, onDone }: { onClose: () => void; onDone: (title: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [author, setAuthor] = useState('');
  const [language, setLanguage] = useState('');
  const [shelf, setShelf] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setFile(f);
    setError(null);
    if (f && !title) setTitle(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim());
  }

  async function submit() {
    if (!file || !title.trim()) return;
    setError(null);
    setProgress(0);
    const form = new FormData();
    form.append('file', file);
    form.append('title', title.trim());
    if (titleHi.trim()) form.append('title_hi', titleHi.trim());
    if (author.trim()) form.append('author', author.trim());
    if (language.trim()) form.append('language', language.trim());
    if (shelf.trim()) form.append('shelf', shelf.trim());

    try {
      await apiUpload<{ id: string }>('/admin/granths/upload', form, setProgress);
      onDone(title.trim());
    } catch (e) {
      setProgress(null);
      // A duplicate is the commonest failure and is not really an error — say
      // what happened rather than showing a raw code.
      if (e instanceof ApiRequestError && e.error.code === 'ALREADY_IN_LIBRARY') {
        setError({ ...e.error, message: `${e.error.message} Nothing was uploaded twice.` });
      } else {
        setError(e);
      }
    }
  }

  const busy = progress !== null;

  return (
    <Modal title="Upload a book" onClose={busy ? () => {} : onClose}>
      <ErrorBox error={error} />

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>PDF</span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
        {file && (
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {file.name} · {humanBytes(file.size)}
          </div>
        )}
      </label>

      <Field label="Title" value={title} onChange={setTitle} disabled={busy} required />
      <Field label="Title (Devanagari)" value={titleHi} onChange={setTitleHi} disabled={busy} />
      <Field label="Author" value={author} onChange={setAuthor} disabled={busy} />
      <Field label="Language" value={language} onChange={setLanguage} disabled={busy} />
      <Field label="Shelf" value={shelf} onChange={setShelf} disabled={busy} />

      {busy && (
        <div style={{ margin: '12px 0' }}>
          <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.round((progress ?? 0) * 100)}%`, height: '100%',
              background: '#1e3a8a', transition: 'width .15s linear',
            }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {/* 100% uploaded is not 100% done — the server still has to hash the
                file and write it to the bucket, which for a large scan is a
                visible pause. Saying so stops people closing the dialog. */}
            {(progress ?? 0) < 1
              ? `Uploading… ${Math.round((progress ?? 0) * 100)}%`
              : 'Uploaded — storing and cataloguing…'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !file || !title.trim()}>
          Add to library
        </button>
      </div>
    </Modal>
  );
}

function Field({
  label, value, onChange, disabled, required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#b91c1c' }}> *</span>}
      </span>
      <input
        style={{ width: '100%' }}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
