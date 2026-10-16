import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { ActionForm, ErrorBox, Modal, useToast } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { DeploymentPill } from './TenantsPage';
import { useCan } from '../auth/permissions';
import { LicenceBadge, MandirFields } from '../components/OfflineMandirFields';
import { clean, day, rupees, useForm } from '../lib/offlineMandir';

/**
 * One offline mandir: who it is, its licence today, every licence it has been
 * issued (with what was paid — its subscription history), and the buttons to
 * issue, renew, or re-issue. See superadmin-api offline-licences.service.ts.
 */

interface Licence {
  id: string;
  licence_id: string;
  kind: 'new' | 'renewal' | 'trial' | 'replacement';
  renews_licence_id: string | null;
  mandir_name: string;
  valid_from: string;
  valid_until: string;
  days: number;
  seats: number;
  key_id: string;
  amount_paise: string | number;
  payment_status: 'paid' | 'unpaid' | 'free';
  payment_mode: string | null;
  payment_reference: string | null;
  paid_on: string | null;
  notes: string | null;
  issued_at: string;
  issued_by_name: string | null;
}

interface Mandir {
  id: string;
  reference: string;
  name: string;
  contact_name: string | null;
  mobile: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  sect: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  /** Demo / test — out of revenue and counts (migration 094). */
  is_demo?: boolean;
  /** Onboarded for both: its online mandir. */
  tenant_id?: string | null;
  tenant_name?: string | null;
  licences: Licence[];
  subscription: {
    current_licence_id: string | null;
    valid_until: string | null;
    state: string;
    days_remaining: number | null;
    total_paid_paise: number;
    total_unpaid_paise: number;
    licence_count: number;
    first_licensed_at: string | null;
  };
}

const KIND_LABEL: Record<string, string> = { new: 'New', renewal: 'Renewal', trial: 'Trial', replacement: 'Re-issue' };
const PAY_TONE: Record<string, string> = { paid: 'green', unpaid: 'red', free: 'blue' };
const MODES = ['UPI', 'Bank transfer', 'Cheque', 'Cash', 'Other'];

/** The licence just issued (or fetched again): copy it, download it. */
function LicenceBlock({ block, fileName, text }: { block: string; fileName: string; text?: string }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text ?? block], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <textarea readOnly value={block} rows={9} className="mono" style={{ width: '100%', fontSize: 12 }} onFocus={(e) => e.target.select()} />
      <div className="actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn primary" type="button" onClick={async () => { await navigator.clipboard.writeText(block); setCopied(true); setTimeout(() => setCopied(false), 2500); }}>
          {copied ? 'Copied ✓' : 'Copy licence'}
        </button>
        <button className="btn" type="button" onClick={download}>Download {fileName}</button>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Send this to the mandir. First start: they paste it on the licence screen. Renewal: Settings → Licence → Renew.
      </p>
    </div>
  );
}

function IssueForm({ mandir, kind, onIssued }: { mandir: Mandir; kind: 'new' | 'renewal' | 'trial' | 'replacement'; onIssued: (r: { block: string; file_name: string; text?: string }) => void }) {
  const { form, set } = useForm({
    days: kind === 'trial' ? '30' : '365',
    amount: '', payment_status: kind === 'trial' || kind === 'replacement' ? 'free' : 'unpaid',
    payment_mode: '', payment_reference: '', paid_on: '', seats: '25', notes: '',
  });
  const current = mandir.subscription;
  const startsLater = kind === 'renewal' && current.valid_until && new Date(current.valid_until) > new Date();
  const from = startsLater ? new Date(current.valid_until as string) : new Date();
  const until = kind === 'replacement' && current.valid_until
    ? new Date(current.valid_until)
    : new Date(from.getTime() + (Number(form.days) || 0) * 86400000);
  return (
    <ActionForm
      submitLabel={kind === 'replacement' ? 'Re-issue licence' : kind === 'renewal' ? 'Renew and issue licence' : 'Issue licence'}
      successMessage={null}
      onSubmit={async () => {
        const r = await api<{ block: string; file_name: string; text: string }>(`/admin/offline-mandirs/${mandir.id}/licences`, {
          method: 'POST',
          body: clean({
            kind, days: form.days, seats: form.seats, payment_status: form.payment_status,
            amount_paise: form.amount ? String(Math.round(Number(form.amount) * 100)) : '0',
            payment_mode: form.payment_mode, payment_reference: form.payment_reference, paid_on: form.paid_on, notes: form.notes,
          }),
        });
        onIssued(r.data);
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Signed for <b>{mandir.name}</b>.{' '}
        {kind === 'renewal' && (startsLater
          ? <>Starts when the current licence ends ({day(current.valid_until)}), so no days are lost.</>
          : <>The current licence has ended, so this starts today.</>)}
        {kind === 'replacement' && <>Same expiry as now ({day(current.valid_until)}) — for a lost licence file or a corrected name.</>}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {kind !== 'replacement' && (
          <label className="field"><span>Term</span>
            <select value={form.days} onChange={set('days')}>
              <option value="30">30 days (trial)</option><option value="90">3 months</option><option value="180">6 months</option>
              <option value="365">1 year</option><option value="730">2 years</option><option value="1095">3 years</option>
            </select>
          </label>
        )}
        <label className="field"><span>Valid until</span><input readOnly value={day(until.toISOString())} /></label>
        <label className="field"><span>Users (seats)</span><input type="number" min={1} max={500} value={form.seats} onChange={set('seats')} /></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <label className="field"><span>Amount (₹)</span><input type="number" min={0} step="0.01" value={form.amount} onChange={set('amount')} placeholder="0" /></label>
        <label className="field"><span>Payment</span>
          <select value={form.payment_status} onChange={set('payment_status')}>
            <option value="unpaid">Not paid yet</option><option value="paid">Paid</option><option value="free">Free / no charge</option>
          </select>
        </label>
        {form.payment_status === 'paid' && (
          <label className="field"><span>Paid on</span><input type="date" value={form.paid_on} onChange={set('paid_on')} /></label>
        )}
      </div>
      {form.payment_status === 'paid' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <label className="field"><span>Mode</span>
            <select value={form.payment_mode} onChange={set('payment_mode')}><option value="">—</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <label className="field"><span>Reference (UTR / cheque no.)</span><input value={form.payment_reference} onChange={set('payment_reference')} /></label>
        </div>
      )}
      <label className="field"><span>Notes (internal)</span><input value={form.notes} onChange={set('notes')} /></label>
    </ActionForm>
  );
}

/**
 * Temple Admin forgot the PIN and has no licence to hand: they read us the
 * request code on their screen; this returns a one-time reset code (24 hours,
 * that request and this mandir only) to send back by WhatsApp.
 */
function PinResetForm({ mandir }: { mandir: Mandir }) {
  const [request, setRequest] = useState('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ reset_code: string; expires_at: string; request_code: string } | null>(null);
  const [copied, setCopied] = useState(false);
  if (result) {
    return (
      <div>
        <p className="muted" style={{ marginTop: 0 }}>
          Reset code for request <span className="mono">{result.request_code}</span> — valid until{' '}
          {new Date(result.expires_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, once, on that computer only.
          Send it to the Temple Admin; they paste it under Forgot PIN → Ask Tasqbots for a code.
        </p>
        <textarea readOnly value={result.reset_code} rows={4} className="mono" style={{ width: '100%', fontSize: 12 }} onFocus={(e) => e.target.select()} />
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          <button className="btn primary" type="button" onClick={async () => { await navigator.clipboard.writeText(result.reset_code); setCopied(true); }}>
            {copied ? 'Copied ✓' : 'Copy reset code'}
          </button>
        </div>
      </div>
    );
  }
  return (
    <ActionForm
      submitLabel="Make reset code"
      successMessage={null}
      onSubmit={async () => {
        const r = await api<{ reset_code: string; expires_at: string; request_code: string }>(`/admin/offline-mandirs/${mandir.id}/pin-reset-code`, {
          method: 'POST', body: { request_code: request, note: note || undefined },
        });
        setResult(r.data);
      }}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Confirm you are speaking to the mandir&apos;s Temple Admin first (call back on {mandir.mobile ?? 'their registered number'}).
        Then enter the request code shown on their screen (Forgot PIN → Ask Tasqbots for a code).
      </p>
      <label className="field"><span>Request code</span>
        <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder="RQ-XXXX-XXXX-XXXX" className="mono" required />
      </label>
      <label className="field"><span>Note (who asked, how you checked)</span><input value={note} onChange={(e) => setNote(e.target.value)} /></label>
    </ActionForm>
  );
}

function PaymentForm({ licence, onDone }: { licence: Licence; onDone: () => void }) {
  const { form, set } = useForm({
    payment_status: licence.payment_status === 'unpaid' ? 'paid' : licence.payment_status,
    amount: String(Number(licence.amount_paise) / 100),
    payment_mode: licence.payment_mode ?? '', payment_reference: licence.payment_reference ?? '',
    paid_on: licence.paid_on?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });
  return (
    <ActionForm
      submitLabel="Save payment"
      successMessage={null}
      onSubmit={async () => {
        await api(`/admin/offline-mandirs/licences/${licence.id}/payment`, {
          method: 'PATCH',
          body: clean({ ...form, amount_paise: String(Math.round(Number(form.amount || 0) * 100)) }),
        });
        onDone();
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span>Payment</span>
          <select value={form.payment_status} onChange={set('payment_status')}>
            <option value="paid">Paid</option><option value="unpaid">Not paid yet</option><option value="free">Free / no charge</option>
          </select>
        </label>
        <label className="field"><span>Amount (₹)</span><input type="number" min={0} step="0.01" value={form.amount} onChange={set('amount')} /></label>
        <label className="field"><span>Mode</span>
          <select value={form.payment_mode} onChange={set('payment_mode')}><option value="">—</option>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
        </label>
        <label className="field"><span>Paid on</span><input type="date" value={form.paid_on} onChange={set('paid_on')} /></label>
      </div>
      <label className="field"><span>Reference (UTR / cheque no.)</span><input value={form.payment_reference} onChange={set('payment_reference')} /></label>
    </ActionForm>
  );
}

export function OfflineMandirDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [m, setM] = useState<Mandir | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [issuing, setIssuing] = useState<'new' | 'renewal' | 'trial' | 'replacement' | null>(null);
  const [issued, setIssued] = useState<{ block: string; file_name: string; text?: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<Licence | null>(null);
  const [resetting, setResetting] = useState(false);
  const toast = useToast();
  const canManage = useCan('mandirs.manage');
  const canBill = useCan('billing.manage');
  const canPin = useCan('offline.pin_reset');

  const load = useCallback(() => {
    api<Mandir>(`/admin/offline-mandirs/${id}`).then((r) => { setM(r.data); setError(null); }).catch(setError);
  }, [id]);
  useEffect(load, [load]);

  async function showFile(l: Licence) {
    try {
      const r = await api<{ file_name: string; text: string; block: string }>(`/admin/offline-mandirs/licences/${l.id}/file`);
      setIssued({ block: r.data.block, file_name: r.data.file_name, text: r.data.text });
    } catch (e) { setError(e); }
  }

  if (!m) return <div><ErrorBox error={error} /><p className="muted">Loading…</p></div>;
  const s = m.subscription;
  const hasLicence = s.licence_count > 0;
  const editForm = (
    <EditMandir mandir={m} onDone={() => { setEditing(false); load(); toast.show('Saved.'); }} />
  );

  return (
    <div>
      <PageHeader
        crumbs={[{ to: m.tenant_id ? '/mandirs' : '/mandirs?deployment=offline', label: 'Manage Mandir' }]}
        title={m.name}
        badges={<>
          <span className="mono muted">{m.reference}</span>
          <DeploymentPill value={m.tenant_id ? 'both' : 'offline'} />
          {m.status !== 'active' && <span className="badge">{m.status}</span>}
          {m.is_demo && <span className="badge demo">demo</span>}
        </>}
        subtitle={m.tenant_id
          ? <>The JainERP Offline side of <Link to={`/mandirs/${m.tenant_id}`}>{m.tenant_name ?? 'its online mandir'}</Link> — licences and what each term was paid.</>
          : 'JainERP Offline — runs on one computer with no internet. Licences and what each term was paid.'}
        actions={<>
          {m.tenant_id && <Link className="btn" to={`/mandirs/${m.tenant_id}`}>Online mandir →</Link>}
          {canBill && <button className="btn" data-testid="toggle-demo" onClick={async () => {
            if (!m.is_demo && !window.confirm(`Mark "${m.name}" as a demo / test mandir? It will be left out of revenue and counts.`)) return;
            try {
              await api(`/admin/offline-mandirs/${m.id}/demo`, { method: 'PATCH', body: { is_demo: !m.is_demo } });
              load();
              toast.show(m.is_demo ? 'Counted as a customer again.' : 'Marked as demo — left out of revenue and counts.');
            } catch (e) { setError(e); }
          }}>{m.is_demo ? 'Count as a customer' : 'Mark as demo / test'}</button>}
        </>}
      />
      <ErrorBox error={error} />

      <div className="card">
        <h2>Subscription</h2>
        <dl className="kv">
          <dt>Licence</dt><dd><LicenceBadge state={s.state} days={s.days_remaining} /> {s.current_licence_id && <span className="mono muted">{s.current_licence_id}</span>}</dd>
          <dt>Valid until</dt><dd>{day(s.valid_until)}</dd>
          <dt>Licensed since</dt><dd>{day(s.first_licensed_at)}</dd>
          <dt>Paid so far</dt><dd>{rupees(s.total_paid_paise)}</dd>
          <dt>Due</dt><dd>{Number(s.total_unpaid_paise) > 0 ? <b style={{ color: '#b91c1c' }}>{rupees(s.total_unpaid_paise)}</b> : '—'}</dd>
          <dt>Licences issued</dt><dd>{s.licence_count}</dd>
        </dl>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {canBill && !hasLicence && <button className="btn primary" disabled={m.status === 'closed'} onClick={() => setIssuing('new')}>Issue licence</button>}
          {canBill && !hasLicence && <button className="btn" disabled={m.status === 'closed'} onClick={() => setIssuing('trial')}>Issue trial</button>}
          {canBill && hasLicence && <button className="btn primary" disabled={m.status === 'closed'} onClick={() => setIssuing('renewal')}>Renew</button>}
          {canPin && hasLicence && (
            <button className="btn" onClick={() => setResetting(true)} title="Temple Admin forgot the PIN and has no licence to hand">Temple Admin forgot PIN?</button>
          )}
          {canBill && hasLicence && (s.state === 'active' || s.state === 'expiring') && (
            <button className="btn" onClick={() => setIssuing('replacement')} title="Same expiry — for a lost licence file or a corrected name">Re-issue</button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Licences &amp; payments</h2>
        <table className="data">
          <thead><tr><th>Licence</th><th>Type</th><th>Period</th><th>Amount</th><th>Payment</th><th>Issued</th><th></th></tr></thead>
          <tbody>
            {m.licences.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.licence_id}{l.renews_licence_id && <div className="muted" style={{ fontSize: 11 }}>renews {l.renews_licence_id}</div>}</td>
                <td>{KIND_LABEL[l.kind] ?? l.kind}</td>
                <td>{day(l.valid_from)} → {day(l.valid_until)}<div className="muted" style={{ fontSize: 11 }}>{l.days} days · {l.seats} users</div></td>
                <td>{rupees(l.amount_paise)}</td>
                <td>
                  <span className={`badge ${PAY_TONE[l.payment_status]}`}>{l.payment_status === 'unpaid' ? 'not paid' : l.payment_status}</span>
                  {l.paid_on && <div className="muted" style={{ fontSize: 11 }}>{day(l.paid_on)}{l.payment_mode ? ` · ${l.payment_mode}` : ''}{l.payment_reference ? ` · ${l.payment_reference}` : ''}</div>}
                </td>
                <td>{day(l.issued_at)}<div className="muted" style={{ fontSize: 11 }}>{l.issued_by_name ?? ''}</div></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canBill && <><button className="btn sm" onClick={() => showFile(l)}>Licence</button>{' '}
                  <button className="btn sm" onClick={() => setPaying(l)}>Payment</button></>}
                </td>
              </tr>
            ))}
            {m.licences.length === 0 && <tr><td colSpan={7} className="muted">No licence issued yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Mandir</h2>
        <dl className="kv">
          <dt>Status</dt><dd><span className={`badge ${m.status === 'active' ? 'green' : ''}`}>{m.status}</span></dd>
          <dt>Contact</dt><dd>{m.contact_name ?? '—'} {m.mobile ?? ''} {m.email ?? ''}</dd>
          <dt>Address</dt><dd>{[m.address, m.city, m.state, m.pincode].filter(Boolean).join(', ') || '—'}</dd>
          <dt>Sampradaya</dt><dd>{m.sect ?? '—'}</dd>
          <dt>Onboarded</dt><dd>{day(m.created_at)}</dd>
          <dt>Notes</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{m.notes ?? '—'}</dd>
        </dl>
        <div className="actions" style={{ justifyContent: 'flex-start' }}>
          {canManage && <button className="btn" onClick={() => setEditing(true)}>Edit details</button>}
        </div>
      </div>

      {issuing && (
        <Modal title={issuing === 'renewal' ? 'Renew licence' : issuing === 'replacement' ? 'Re-issue licence' : issuing === 'trial' ? 'Issue trial licence' : 'Issue licence'} onClose={() => setIssuing(null)} wide>
          <IssueForm mandir={m} kind={issuing} onIssued={(r) => { setIssuing(null); setIssued(r); load(); }} />
        </Modal>
      )}
      {issued && (
        <Modal title="Licence" onClose={() => setIssued(null)} wide confirmDiscard={false}>
          <LicenceBlock block={issued.block} fileName={issued.file_name} text={issued.text} />
        </Modal>
      )}
      {paying && (
        <Modal title={`Payment — ${paying.licence_id}`} onClose={() => setPaying(null)}>
          <PaymentForm licence={paying} onDone={() => { setPaying(null); load(); }} />
        </Modal>
      )}
      {resetting && (
        <Modal title="Temple Admin PIN reset code" onClose={() => setResetting(false)} wide confirmDiscard={false}>
          <PinResetForm mandir={m} />
        </Modal>
      )}
      {toast.node}
      {editing && <Modal title="Edit offline mandir" onClose={() => setEditing(false)} wide>{editForm}</Modal>}
    </div>
  );
}

function EditMandir({ mandir, onDone }: { mandir: Mandir; onDone: () => void }) {
  const { form, set } = useForm(Object.fromEntries(
    ['name', 'contact_name', 'mobile', 'email', 'address', 'city', 'state', 'pincode', 'sect', 'notes', 'status']
      .map((k) => [k, String((mandir as unknown as Record<string, unknown>)[k] ?? '')]),
  ));
  return (
    <ActionForm submitLabel="Save" successMessage={null}
      onSubmit={async () => { await api(`/admin/offline-mandirs/${mandir.id}`, { method: 'PATCH', body: clean(form) }); onDone(); }}>
      {form.name !== mandir.name && (
        <p className="muted" style={{ marginTop: 0 }}>A new name reaches the mandir's app with the next licence — use <b>Re-issue</b> after saving.</p>
      )}
      <MandirFields form={form} set={set} />
      <label className="field"><span>Status</span>
        <select value={form.status} onChange={set('status')}>
          <option value="active">Active</option><option value="paused">Paused</option><option value="closed">Closed (no more licences)</option>
        </select>
      </label>
    </ActionForm>
  );
}
