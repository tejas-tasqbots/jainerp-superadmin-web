import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Upload } from 'lucide-react';
import { api, apiUpload, ApiRequestError, formatDate } from '../api/client';
import { ActionForm, ErrorBox, Modal, Pagination, useToast } from '../components/ui';
import { EmptyRow, PageHeader } from '../components/PageHeader';
import { RichText, RichTextEditor } from '../components/RichTextEditor';
import { DraftBar, DraftStatus, useFormDraft, hasFormDraft } from '../components/useFormDraft';
import { useCan } from '../auth/permissions';

/**
 * The granth library — platform content, curated here and nowhere else.
 *
 * Laid out like Manage Mandir: a header with the one main action (Upload),
 * the library's numbers, one filter bar, one table; a book opens into its
 * details with Edit beside them. Every form keeps a draft.
 *
 * ── WHAT THE MIRROR NUMBER MEANS ────────────────────────────────────────────
 * The catalogue was scraped as metadata: 4,498 rows whose files sat on another
 * site's Google Drive. Migrations 075/076 move those files to our own origin;
 * until that finishes some books still open at the source. "Still at the
 * source" is how far that has got.
 *
 * "About this book" (migration 098) is rich text, cleaned by the API to a safe
 * subset (common/rich-text.ts) before it is stored.
 */

interface GranthRow {
  id: string; title: string; title_hi: string | null; author: string | null; language: string | null; shelf: string | null;
  source: string | null; file_name: string; sant_id: string | null; sant_relation: 'by' | 'about' | null; sant_name: string | null;
  verified: boolean; mirror_path: string | null; file_bytes: string | number | null; mirrored_at: string | null; created_at: string;
  has_description: boolean;
}
interface Granth extends GranthRow {
  description_html: string | null; description_hi_html: string | null; open_url: string | null; sha256: string | null; updated_at: string | null;
}
interface LibraryStats { total: number; mirrored: number; uploaded: number; distinct_objects: number; bytes: string | number; bucket: string | null; origin_configured: boolean }
interface Facets { shelves: Array<{ value: string; n: number }>; languages: Array<{ value: string; n: number }> }

const PAGE = 25;
function humanBytes(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  if (!n) return '—';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const [rows, setRows] = useState<GranthRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [facets, setFacets] = useState<Facets>({ shelves: [], languages: [] });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(get('q'));
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const canCurate = useCan('content.manage');
  const toast = useToast();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
    setPage(1);
  };
  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE) });
    for (const k of ['q', 'mirrored', 'shelf', 'language', 'published', 'sant']) { const v = params.get(k); if (v) qs.set(k, v); }
    api<GranthRow[]>(`/admin/granths?${qs}`).then((r) => { setRows(r.data ?? []); setTotal(r.meta?.total ?? 0); setError(null); }).catch(setError);
    api<LibraryStats>('/admin/granths/stats').then((r) => setStats(r.data)).catch(() => undefined);
  }, [params, page]);
  useEffect(load, [load]);
  useEffect(() => { api<Facets>('/admin/granths/facets').then((r) => setFacets(r.data)).catch(() => undefined); }, []);
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== (new URLSearchParams(window.location.search).get('q') ?? '')) update({ q: search.trim() }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const pending = stats ? stats.total - stats.mirrored : 0;
  return (
    <div>
      <PageHeader
        title="Library"
        subtitle="The granth catalogue every mandir and devotee reads from. Platform content — curated here, owned by no mandir."
        actions={canCurate && (
          <button className="btn primary" data-testid="upload-book" onClick={() => setUploading(true)}>
            <Upload size={15} /> {hasFormDraft('granth:upload') ? 'Continue upload…' : 'Upload book'}
          </button>
        )}
      />
      <ErrorBox error={error} />
      {stats && !stats.origin_configured && (
        <div className="notice"><span><b>No storage bucket is configured.</b> Set <code>GRANTH_BUCKET</code> on this API before uploading — until then books can be catalogued but not stored.</span></div>
      )}
      {stats && (
        <div className="stat-grid">
          <div className="stat"><div className="label">Books</div><div className="value">{stats.total.toLocaleString('en-IN')}</div><div className="sub">{stats.uploaded.toLocaleString('en-IN')} uploaded here</div></div>
          <div className="stat"><div className="label">On our origin</div><div className="value">{stats.mirrored.toLocaleString('en-IN')}</div>
            <div className="sub">{pending > 0 ? `${pending.toLocaleString('en-IN')} still open at the source` : 'complete'}</div>
            {pending > 0 && <a className="stat-link" href="#src" onClick={(e) => { e.preventDefault(); update({ mirrored: 'false' }); }}>Show them →</a>}</div>
          <div className="stat"><div className="label">Stored</div><div className="value">{humanBytes(stats.bytes)}</div><div className="sub">{stats.distinct_objects.toLocaleString('en-IN')} files — duplicate scans share one</div></div>
        </div>
      )}

      <div className="filter-bar">
        <input type="search" aria-label="Search" placeholder="Title (English or हिन्दी), author or file name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Shelf" value={get('shelf')} onChange={(e) => update({ shelf: e.target.value })}>
          <option value="">Every shelf</option>
          {facets.shelves.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.n})</option>)}
        </select>
        <select aria-label="Language" value={get('language')} onChange={(e) => update({ language: e.target.value })}>
          <option value="">Any language</option>
          {facets.languages.map((s) => <option key={s.value} value={s.value}>{s.value} ({s.n})</option>)}
        </select>
        <select aria-label="Published" value={get('published')} onChange={(e) => update({ published: e.target.value })}>
          <option value="">Published or not</option><option value="true">Published</option><option value="false">Unpublished</option>
        </select>
        <select aria-label="More" value={get('mirrored') ? `m-${get('mirrored')}` : get('sant')} onChange={(e) => {
          const v = e.target.value;
          update({ mirrored: v.startsWith('m-') ? v.slice(2) : '', sant: v.startsWith('m-') ? '' : v });
        }}>
          <option value="">More filters</option>
          <option value="m-true">File on our origin</option><option value="m-false">Still at the source</option>
          <option value="any">Linked to a Sadhu-Sadhvi</option><option value="undescribed">No "About" yet</option><option value="described">Has an "About"</option>
        </select>
      </div>
      <div className="result-line"><span>{total == null ? 'Loading…' : `${total.toLocaleString('en-IN')} book${total === 1 ? '' : 's'}`}</span></div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Title</th><th>Author</th><th>Shelf · language</th><th>Status</th><th className="num">Size</th><th>Added</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="clickable" data-testid={`book-${g.id}`} onClick={() => setOpenId(g.id)}>
                <td>
                  <strong>{g.title}</strong>
                  {g.title_hi && <div className="sub" lang="hi">{g.title_hi}</div>}
                  {g.sant_name && <div className="sub" style={{ color: g.sant_relation === 'about' ? '#b45309' : undefined }}>{g.sant_relation === 'about' ? 'about' : 'by'} {g.sant_name}</div>}
                </td>
                <td>{g.author || <span className="muted">—</span>}</td>
                <td>{g.shelf || <span className="muted">—</span>}{g.language ? <div className="sub">{g.language}</div> : null}</td>
                <td>
                  {g.verified ? <span className="badge green">published</span> : <span className="badge">unpublished</span>}
                  <div className="sub">{g.mirror_path ? 'our origin' : 'source site'}{g.has_description ? ' · has About' : ''}</div>
                </td>
                <td className="num">{humanBytes(g.file_bytes)}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(g.created_at)}<div className="sub">{g.source === 'upload' ? 'uploaded here' : g.source || ''}</div></td>
              </tr>
            ))}
            {total === 0 && <EmptyRow colSpan={6} title="No books match.">Try the other script, or clear a filter.</EmptyRow>}
          </tbody>
        </table>
      </div>
      {total != null && <Pagination page={page} total={total} limit={PAGE} onPage={setPage} />}

      {uploading && <UploadBook facets={facets} onClose={() => setUploading(false)} onDone={(id, title) => { setUploading(false); toast.show(`"${title}" added to the library.`); load(); setOpenId(id); }} />}
      {openId && <BookView id={openId} facets={facets} onClose={() => setOpenId(null)} onChanged={load} toast={toast.show} />}
      {toast.node}
    </div>
  );
}

const EMPTY_META = { title: '', title_hi: '', author: '', language: '', shelf: '', sant_id: '', sant_name: '', sant_relation: '', description_html: '', description_hi_html: '' };

/** Shelf / language: pick one in use, or type a new one (a datalist). */
function Suggest({ id, label, value, onChange, options, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; n: number }>; placeholder?: string }) {
  return (
    <label className="field"><span>{label}</span>
      <input list={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <datalist id={id}>{options.map((o) => <option key={o.value} value={o.value}>{o.n} books</option>)}</datalist>
    </label>
  );
}

/** Find a Sadhu-Sadhvi by name (either script). */
function SantPicker({ name, onPick }: { name: string; onPick: (id: string, name: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Array<{ id: string; name: string; name_hi: string | null; name_en: string | null; type: string }>>([]);
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); return; }
    const t = setTimeout(() => {
      api<typeof hits>(`/admin/maharaj?limit=8&q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.data ?? [])).catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="field" style={{ position: 'relative' }}>
      <span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Sadhu-Sadhvi (optional)</span>
      {name ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="badge blue" style={{ fontSize: 13 }}>{name}</span>
          <button type="button" className="btn sm" onClick={() => onPick('', '')}>Remove</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name in either script…" />
          {hits.length > 0 && (
            <div className="suggest-list">
              {hits.map((h) => (
                <button key={h.id} type="button" onClick={() => { onPick(h.id, h.name_hi || h.name_en || h.name); setQ(''); setHits([]); }}>
                  {h.name_hi || h.name_en || h.name} <span className="muted">· {h.type}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The metadata fields shared by Upload and Edit. */
function MetaFields({ f, setF, facets }: { f: typeof EMPTY_META; setF: (p: Partial<typeof EMPTY_META>) => void; facets: Facets }) {
  return (
    <>
      <div className="form-grid">
        <label className="field span-2"><span>Title *</span><input name="title" value={f.title} onChange={(e) => setF({ title: e.target.value })} required /></label>
        <label className="field span-2"><span>Title in Devanagari</span><input name="title_hi" lang="hi" value={f.title_hi} onChange={(e) => setF({ title_hi: e.target.value })} /></label>
        <label className="field"><span>Author</span><input name="author" value={f.author} onChange={(e) => setF({ author: e.target.value })} placeholder="Acharya Shri …" /></label>
        <Suggest id="dl-lang" label="Language" value={f.language} onChange={(v) => setF({ language: v })} options={facets.languages} placeholder="Hindi, Sanskrit, Prakrit…" />
        <Suggest id="dl-shelf" label="Shelf" value={f.shelf} onChange={(v) => setF({ shelf: v })} options={facets.shelves} placeholder="Choose a shelf in use, or type a new one" />
        <SantPicker name={f.sant_name} onPick={(id, n) => setF({ sant_id: id, sant_name: n, sant_relation: id ? (f.sant_relation || 'by') : '' })} />
        {f.sant_id && (
          <div className="field span-2">
            <span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>This book is…</span>
            <div className="seg">
              <button type="button" className={f.sant_relation === 'by' ? 'active' : ''} onClick={() => setF({ sant_relation: 'by' })}>BY them (their work)</button>
              <button type="button" className={f.sant_relation === 'about' ? 'active' : ''} onClick={() => setF({ sant_relation: 'about' })}>ABOUT them (a biography)</button>
            </div>
          </div>
        )}
      </div>
      <h4 className="form-section">About this book</h4>
      <div className="form-grid">
        <div className="field"><span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>In Hindi</span>
          <RichTextEditor lang="hi" testId="about-hi" value={f.description_hi_html} onChange={(v) => setF({ description_hi_html: v })} placeholder="यह ग्रंथ…" /></div>
        <div className="field"><span style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 4 }}>In English</span>
          <RichTextEditor testId="about-en" value={f.description_html} onChange={(v) => setF({ description_html: v })} placeholder="What the book is, who wrote it, why read it…" /></div>
      </div>
    </>
  );
}

function UploadBook({ facets, onClose, onDone }: { facets: Facets; onClose: () => void; onDone: (id: string, title: string) => void }) {
  // The file cannot be kept in a draft — the details typed beside it can.
  const d = useFormDraft('granth:upload', EMPTY_META);
  const f = d.form;
  const setF = (p: Partial<typeof EMPTY_META>) => d.setForm((x) => ({ ...x, ...p }));
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);

  function pick(fl: File | null) {
    setError(null);
    if (fl && !/\.pdf$/i.test(fl.name) && fl.type !== 'application/pdf') { setError(new Error('Only PDF files — granths are scanned books.')); return; }
    if (fl && fl.size > 31 * 1048576) { setError(new Error(`That file is ${(fl.size / 1048576).toFixed(0)} MB; uploads here are capped at 31 MB. Large scans go in through the bulk mirror.`)); return; }
    setFile(fl);
    if (fl && !f.title) setF({ title: fl.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() });
  }
  async function submit() {
    if (!file || !f.title.trim()) return;
    if (f.sant_id && !f.sant_relation) { setError(new Error('Say whether the book is BY the Sadhu-Sadhvi or ABOUT them.')); return; }
    setError(null); setProgress(0);
    const form = new FormData();
    form.append('file', file);
    for (const k of ['title', 'title_hi', 'author', 'language', 'shelf', 'sant_id', 'sant_relation', 'description_html', 'description_hi_html'] as const) {
      if (String(f[k]).trim()) form.append(k, String(f[k]).trim());
    }
    try {
      const r = await apiUpload<{ id: string }>('/admin/granths/upload', form, setProgress);
      d.clear();
      onDone(r.id, f.title.trim());
    } catch (e) {
      setProgress(null);
      setError(e instanceof ApiRequestError && e.error.code === 'ALREADY_IN_LIBRARY' ? { ...e.error, message: `${e.error.message} Nothing was uploaded twice.` } : e);
    }
  }
  const busy = progress !== null;
  return (
    <Modal title="Upload a book" onClose={busy ? () => undefined : onClose} wide confirmDiscard={false}>
      <DraftBar draft={d} />
      <ErrorBox error={error} />
      <div className={`dropzone${over ? ' over' : ''}`} data-testid="dropzone" onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0] ?? null); }}>
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden disabled={busy} onChange={(e) => pick(e.target.files?.[0] ?? null)} data-testid="file-input" />
        {file ? <><b>{file.name}</b><div className="muted" style={{ fontSize: 12 }}>{humanBytes(file.size)} · click to choose another</div></>
          : <><b>Drop the PDF here</b> or click to choose<div className="muted" style={{ fontSize: 12 }}>One scanned book, up to 31 MB</div></>}
      </div>
      <div style={{ marginTop: 14 }}><MetaFields f={f} setF={setF} facets={facets} /></div>
      {busy && (
        <div style={{ margin: '12px 0' }}>
          <div style={{ height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
            <div style={{ width: `${Math.round((progress ?? 0) * 100)}%`, height: '100%', background: 'var(--color-brand-blue)', transition: 'width .15s linear' }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{(progress ?? 0) < 1 ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : 'Uploaded — storing and cataloguing…'}</div>
        </div>
      )}
      <div className="actions">
        <DraftStatus draft={d} />
        <button className="btn" onClick={onClose} disabled={busy}>Close</button>
        <button className="btn primary" data-testid="upload-submit" onClick={submit} disabled={busy || !file || !f.title.trim()}>Add to library</button>
      </div>
    </Modal>
  );
}

function BookView({ id, facets, onClose, onChanged, toast }: { id: string; facets: Facets; onClose: () => void; onChanged: () => void; toast: (t: string, tone?: 'ok' | 'bad') => void }) {
  const [g, setG] = useState<Granth | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tab, setTab] = useState<'view' | 'edit'>('view');
  const canCurate = useCan('content.manage');
  const load = useCallback(() => { api<Granth>(`/admin/granths/${id}`).then((r) => setG(r.data)).catch(setError); }, [id]);
  useEffect(load, [load]);
  if (!g) return <Modal title="Book" onClose={onClose} wide confirmDiscard={false}><ErrorBox error={error} /><p className="muted">Loading…</p></Modal>;

  async function publish(v: boolean) {
    try { await api(`/admin/granths/${id}`, { method: 'PATCH', body: { verified: v } }); load(); onChanged(); toast(v ? 'Published — devotees can read it.' : 'Unpublished — hidden from devotees.'); } catch (e) { setError(e); }
  }
  return (
    <Modal title={g.title} onClose={onClose} wide confirmDiscard={false}>
      <ErrorBox error={error} />
      <div className="book-head">
        <div className="cover">ग्रं</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {g.title_hi && <div lang="hi" style={{ fontSize: 16, fontWeight: 600 }}>{g.title_hi}</div>}
          <div className="muted">{[g.author, g.language, g.shelf].filter(Boolean).join(' · ') || '—'}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {g.verified ? <span className="badge green">published</span> : <span className="badge">unpublished</span>}
            <span className="badge blue">{g.mirror_path ? 'file on our origin' : 'file at the source'}</span>
            {g.sant_name && <span className="badge">{g.sant_relation === 'about' ? 'about' : 'by'} {g.sant_name}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {g.open_url && <a className="btn" href={g.open_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open PDF</a>}
          {canCurate && (g.verified
            ? <button className="btn" onClick={() => { if (window.confirm('Unpublish this book? Devotees stop seeing it.')) void publish(false); }}>Unpublish</button>
            : <button className="btn primary" onClick={() => publish(true)}>Publish</button>)}
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'view' ? 'active' : ''} onClick={() => setTab('view')}>Details</button>
        {canCurate && <button className={tab === 'edit' ? 'active' : ''} data-testid="book-edit-tab" onClick={() => setTab('edit')}>Edit</button>}
      </div>
      {tab === 'view' && (
        <div className="form-grid">
          <section>
            <h4 className="form-section">About (Hindi)</h4>
            {g.description_hi_html ? <RichText html={g.description_hi_html} lang="hi" /> : <p className="muted">Not written yet.</p>}
          </section>
          <section>
            <h4 className="form-section">About (English)</h4>
            {g.description_html ? <RichText html={g.description_html} /> : <p className="muted">Not written yet.</p>}
          </section>
          <section className="span-2">
            <h4 className="form-section">File</h4>
            <dl className="kv">
              <dt>File name</dt><dd className="mono">{g.file_name}</dd>
              <dt>Size</dt><dd>{humanBytes(g.file_bytes)}</dd>
              <dt>Added</dt><dd>{formatDate(g.created_at)} · {g.source === 'upload' ? 'uploaded here' : g.source ?? '—'}</dd>
              <dt>SHA-256</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{g.sha256 ?? '—'}</dd>
            </dl>
          </section>
        </div>
      )}
      {tab === 'edit' && <EditBook g={g} facets={facets} onDone={() => { load(); onChanged(); setTab('view'); toast('Saved.'); }} />}
    </Modal>
  );
}

function EditBook({ g, facets, onDone }: { g: Granth; facets: Facets; onDone: () => void }) {
  const initial = {
    title: g.title, title_hi: g.title_hi ?? '', author: g.author ?? '', language: g.language ?? '', shelf: g.shelf ?? '',
    sant_id: g.sant_id ?? '', sant_name: g.sant_name ?? '', sant_relation: g.sant_relation ?? '',
    description_html: g.description_html ?? '', description_hi_html: g.description_hi_html ?? '',
  };
  const d = useFormDraft(`granth:${g.id}`, initial, { baseStamp: g.updated_at ?? g.created_at });
  const f = d.form;
  return (
    <ActionForm draft={false} submitLabel="Save changes" successMessage={null} secondary={<DraftStatus draft={d} />}
      onSubmit={async () => {
        if (f.sant_id && !f.sant_relation) throw new Error('Say whether the book is BY the Sadhu-Sadhvi or ABOUT them.');
        await api(`/admin/granths/${g.id}`, { method: 'PATCH', body: {
          title: f.title.trim(), title_hi: f.title_hi, author: f.author, language: f.language, shelf: f.shelf,
          sant_id: f.sant_id || null, sant_relation: f.sant_id ? f.sant_relation : null,
          description_html: f.description_html, description_hi_html: f.description_hi_html,
        } });
        d.clear();
        onDone();
      }}>
      <DraftBar draft={d} />
      <MetaFields f={f} setF={(p) => d.setForm((x) => ({ ...x, ...p }))} facets={facets} />
    </ActionForm>
  );
}
