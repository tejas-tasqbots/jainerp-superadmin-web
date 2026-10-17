import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { api, formatDate, formatPaise, type ApiMeta } from '../api/client';
import { ActionForm, ErrorBox, Modal, Pagination, useToast } from '../components/ui';
import { EmptyRow, PageHeader } from '../components/PageHeader';
import { DraftBar, DraftStatus, useFormDraft, hasFormDraft } from '../components/useFormDraft';
import { OnboardingWizard } from '../components/OnboardingWizard';
import { StateSelect, CitySelect } from '../components/GeoSelect';
import { useCan, useMe } from '../auth/permissions';
import { DeleteEntryButton } from '../components/DeleteEntryButton';

/**
 * Leads — the sales pipeline (superadmin-api leads/leads.ts, migration 097).
 *
 * Laid out like Manage Mandir: pipeline stages as tabs with counts and value,
 * one filter bar, one table; a lead opens into its details and timeline. Add a
 * lead by hand (drafts kept), log every call / WhatsApp / meeting with the next
 * follow-up, move it along the stages, and "Onboard this mandir" opens the
 * onboarding form already filled in — the lead becomes Won when it completes.
 */

export const STAGES: Array<[string, string]> = [
  ['new', 'New'], ['contacted', 'Contacted'], ['demo_scheduled', 'Demo scheduled'], ['demo_done', 'Demo done'],
  ['proposal', 'Proposal sent'], ['won', 'Won'], ['lost', 'Lost'],
];
const STAGE_LABEL = Object.fromEntries(STAGES);
const STAGE_TONE: Record<string, string> = { new: 'blue', contacted: 'blue', demo_scheduled: 'in_progress', demo_done: 'in_progress', proposal: 'in_progress', won: 'green', lost: 'red' };
const SOURCES: Array<[string, string]> = [
  ['manual', 'Added by hand'], ['call', 'Phone call'], ['whatsapp', 'WhatsApp'], ['referral', 'Referral'], ['event', 'Event / Mahotsav'],
  ['walk_in', 'Walk-in'], ['social', 'Social media'], ['website_demo', 'Website demo request'], ['website_custom', 'Website custom-plan request'], ['other', 'Other'],
];
const SOURCE_LABEL = Object.fromEntries(SOURCES);
const KINDS: Array<[string, string]> = [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['meeting', 'Meeting'], ['email', 'Email'], ['note', 'Note']];

interface Lead {
  id: string; reference: string; trust_name: string; contact_name: string | null; mobile: string | null; email: string | null;
  city: string | null; state: string | null; sect: string | null; interest: string; expected_plan: string | null; expected_value_paise: number | null;
  source: string; stage: string; lost_reason: string | null; owner_id: string | null; owner_name: string | null; next_follow_up: string | null;
  follow_up_overdue_days: number | null; notes: string | null; tenant_id: string | null; tenant_name: string | null;
  offline_mandir_id: string | null; offline_reference?: string | null; last_activity_at: string | null; created_at: string; stage_changed_at: string;
  created_by_name?: string | null;
  activities?: Array<{ id: string; kind: string; body: string | null; meta: Record<string, unknown>; by_name: string | null; created_at: string }>;
}
type Meta = ApiMeta & { counts: Record<string, number>; values: Record<string, number>; follow_ups: { overdue: number; today: number }; website_to_import: { demo: number; custom: number } };
interface TeamMember { id: string; name: string | null; email: string | null; is_active: boolean }

const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plusDays = (d: number) => new Date(Date.now() + 330 * 60000 + d * 86400000).toISOString().slice(0, 10);

function FollowUp({ l }: { l: Lead }) {
  if (l.stage === 'won' || l.stage === 'lost') return <span className="muted">—</span>;
  if (!l.next_follow_up) return <span className="muted">not set</span>;
  const late = l.follow_up_overdue_days ?? 0;
  return (
    <>
      {formatDate(l.next_follow_up)}
      <div className="sub" style={{ color: late > 0 ? 'var(--color-danger)' : late === 0 ? '#b45309' : undefined, fontWeight: late >= 0 ? 600 : 400 }}>
        {late > 0 ? `${late} day${late === 1 ? '' : 's'} overdue` : late === 0 ? 'today' : `in ${-late} day${late === -1 ? '' : 's'}`}
      </div>
    </>
  );
}

export function LeadsPage() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const stage = get('stage') || 'open';
  const [rows, setRows] = useState<Lead[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(get('q'));
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(get('lead') || null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const canWork = useCan('enquiries.manage');
  const toast = useToast();

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
    setPage(1);
  };
  const load = useCallback(() => {
    const qs = new URLSearchParams({ stage, page: String(page), limit: '25' });
    for (const k of ['q', 'owner', 'due', 'source', 'sort']) { const v = params.get(k); if (v) qs.set(k, v); }
    api<Lead[]>(`/admin/leads?${qs}`).then((r) => { setRows(r.data); setMeta(r.meta as Meta); setError(null); }).catch(setError);
  }, [params, stage, page]);
  useEffect(load, [load]);
  useEffect(() => { api<TeamMember[]>('/admin/users').then((r) => setTeam(r.data.filter((u) => u.is_active))).catch(() => setTeam([])); }, []);
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== (new URLSearchParams(window.location.search).get('q') ?? '')) update({ q: search.trim() }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function importWebsite() {
    try {
      const r = await api<{ imported: number }>('/admin/leads/import-website', { method: 'POST', body: {} });
      toast.show(`${r.data.imported} website enquir${r.data.imported === 1 ? 'y' : 'ies'} added to the pipeline.`);
      load();
    } catch (e) { setError(e); }
  }
  function exportCsv() {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Lead', 'Mandir', 'Contact', 'Mobile', 'City', 'Stage', 'Value (Rs)', 'Owner', 'Next follow-up', 'Source'],
      ...rows.map((l) => [l.reference, l.trust_name, l.contact_name, l.mobile, l.city, STAGE_LABEL[l.stage], l.expected_value_paise != null ? (l.expected_value_paise / 100).toFixed(2) : '', l.owner_name, l.next_follow_up, SOURCE_LABEL[l.source] ?? l.source])];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' }));
    a.download = `jainerp-leads-${stage}-${todayIst()}.csv`;
    a.click();
  }
  const web = meta ? meta.website_to_import.demo + meta.website_to_import.custom : 0;
  const tabs: Array<[string, string]> = [['open', 'Open'], ...STAGES];

  return (
    <div>
      <PageHeader
        title="Leads"
        subtitle="Every mandir we are talking to — added by hand or from the website — with who owns it, the next follow-up and every conversation."
        actions={<>
          <button className="btn" onClick={exportCsv}><Download size={15} /> Export</button>
          {canWork && <button className="btn primary" data-testid="add-lead" onClick={() => setAdding(true)}>
            {hasFormDraft('lead:new') ? 'Continue adding…' : <><Plus size={15} /> Add lead</>}
          </button>}
        </>}
      />
      <ErrorBox error={error} />
      {canWork && web > 0 && (
        <div className="notice" data-testid="import-notice">
          <span><b>{web}</b> new enquir{web === 1 ? 'y' : 'ies'} from the website ({meta!.website_to_import.demo} demo, {meta!.website_to_import.custom} custom plan) not in the pipeline yet.</span>
          <button className="btn sm" onClick={importWebsite}>Add to leads</button>
        </div>
      )}

      <div className="seg" role="tablist" aria-label="Stage">
        {tabs.map(([k, l]) => (
          <button key={k} className={stage === k ? 'active' : ''} onClick={() => update({ stage: k === 'open' ? '' : k })}>
            {l}<span className="count">{meta?.counts[k] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <input type="search" aria-label="Search" placeholder="Mandir, contact, mobile, city or LEAD- reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Follow-up" value={get('due')} onChange={(e) => update({ due: e.target.value })}>
          <option value="">Any follow-up</option>
          <option value="overdue">Overdue{meta?.follow_ups.overdue ? ` (${meta.follow_ups.overdue})` : ''}</option>
          <option value="today">Due today{meta?.follow_ups.today ? ` (${meta.follow_ups.today})` : ''}</option>
          <option value="week">Next 7 days</option>
          <option value="none">No follow-up set</option>
        </select>
        <select aria-label="Owner" value={get('owner')} onChange={(e) => update({ owner: e.target.value })}>
          <option value="">Anyone's</option>
          <option value="me">My leads</option>
          <option value="none">Unassigned</option>
          {team.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
        </select>
        <select aria-label="Source" value={get('source')} onChange={(e) => update({ source: e.target.value })}>
          <option value="">Any source</option>
          {SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <div className="grow" />
        <select aria-label="Sort" value={get('sort')} onChange={(e) => update({ sort: e.target.value })}>
          <option value="">Follow-up first</option><option value="newest">Newest</option><option value="value">Biggest deal</option>
        </select>
      </div>
      <div className="result-line">
        <span>{meta ? `${meta.total} lead${meta.total === 1 ? '' : 's'}${meta.values[stage] ? ` · ${formatPaise(meta.values[stage])} / year in deals` : ''}` : 'Loading…'}</span>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Mandir</th><th>Contact</th><th>Stage</th><th className="num">Deal / year</th><th>Owner</th><th>Next follow-up</th><th>Source</th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="clickable" data-testid={`lead-${l.reference}`} onClick={() => setOpenId(l.id)}>
                <td><strong>{l.trust_name}</strong><div className="sub mono">{l.reference}{l.city ? ` · ${l.city}` : ''}</div></td>
                <td>{l.contact_name ?? '—'}<div className="sub mono">{l.mobile ?? ''}</div></td>
                <td><span className={`badge ${STAGE_TONE[l.stage]}`}>{STAGE_LABEL[l.stage]}</span>{l.tenant_name && <div className="sub">→ {l.tenant_name}</div>}</td>
                <td className="num">{l.expected_value_paise ? formatPaise(l.expected_value_paise) : <span className="muted">—</span>}</td>
                <td>{l.owner_name ?? <span className="muted">unassigned</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}><FollowUp l={l} /></td>
                <td className="muted">{SOURCE_LABEL[l.source] ?? l.source}</td>
              </tr>
            ))}
            {meta && rows.length === 0 && <EmptyRow colSpan={7} title={stage === 'open' ? 'No open leads.' : `No leads in ${STAGE_LABEL[stage] ?? stage}.`}>{canWork ? <>Add one with <b>Add lead</b>.</> : null}</EmptyRow>}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total} limit={25} onPage={setPage} />}

      {adding && (
        <Modal title="Add lead" onClose={() => setAdding(false)} wide confirmDiscard={false}>
          <LeadForm team={team} onDone={(l) => { setAdding(false); load(); toast.show(`${l.reference} added.`); setOpenId(l.id); }} />
        </Modal>
      )}
      {openId && <LeadView id={openId} team={team} onClose={() => { setOpenId(null); update({ lead: '' }); }} onChanged={load} toast={toast.show} />}
      {toast.node}
    </div>
  );
}

const EMPTY_LEAD = {
  trust_name: '', contact_name: '', mobile: '', email: '', state: '', city: '', sect: '', interest: 'unsure',
  expected_plan: '', value: '', source: 'manual', owner_id: '', next_follow_up: plusDays(2), notes: '',
};

/** Add (or edit) a lead. New leads keep a draft; edits do too, per lead. */
function LeadForm({ lead, team, onDone }: { lead?: Lead; team: TeamMember[]; onDone: (l: Lead) => void }) {
  const me = useMe();
  const initial = lead ? {
    trust_name: lead.trust_name, contact_name: lead.contact_name ?? '', mobile: lead.mobile ?? '', email: lead.email ?? '', state: lead.state ?? '',
    city: lead.city ?? '', sect: lead.sect ?? '', interest: lead.interest, expected_plan: lead.expected_plan ?? '',
    value: lead.expected_value_paise != null ? String(lead.expected_value_paise / 100) : '', source: lead.source, owner_id: lead.owner_id ?? '',
    next_follow_up: lead.next_follow_up ?? '', notes: lead.notes ?? '',
  } : { ...EMPTY_LEAD, owner_id: me?.id ?? '' };
  const d = useFormDraft(lead ? `lead:${lead.id}` : 'lead:new', initial, { baseStamp: lead?.stage_changed_at ?? null });
  const f = d.form;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => d.setForm((x) => ({ ...x, [k]: e.target.value }));
  const [dupe, setDupe] = useState<string | null>(null);

  const body = (force: boolean) => ({
    trust_name: f.trust_name, contact_name: f.contact_name, mobile: f.mobile, email: f.email, state: f.state, city: f.city, sect: f.sect,
    interest: f.interest, expected_plan: f.expected_plan, expected_value_paise: f.value ? Math.round(Number(f.value) * 100) : null,
    source: f.source, owner_id: f.owner_id || null, next_follow_up: f.next_follow_up || null, notes: f.notes, ...(force ? { force: true } : {}),
  });
  return (
    <ActionForm draft={false} submitLabel={lead ? 'Save lead' : dupe ? 'Save anyway' : 'Add lead'} successMessage={null}
      secondary={<DraftStatus draft={d} />}
      onSubmit={async () => {
        try {
          const r = lead
            ? await api<Lead>(`/admin/leads/${lead.id}`, { method: 'PATCH', body: body(false) })
            : await api<Lead>('/admin/leads', { method: 'POST', body: body(!!dupe) });
          d.clear();
          onDone(r.data);
        } catch (e) {
          const err = e as { error?: { code?: string; message?: string } };
          if (err.error?.code === 'LEAD_EXISTS') { setDupe(err.error.message ?? 'Possible duplicate'); return; }
          throw e;
        }
      }}>
      <DraftBar draft={d} />
      {dupe && <div className="notice" data-testid="lead-duplicate"><span>{dupe}</span></div>}
      <h4 className="form-section">Mandir</h4>
      <div className="form-grid">
        <label className="field span-2"><span>Mandir / trust name *</span><input name="trust_name" value={f.trust_name} onChange={set('trust_name')} required autoFocus placeholder="Shri Neminath Digambar Jain Mandir" /></label>
        <label className="field"><span>State</span><StateSelect value={f.state} onChange={(s) => d.setForm((x) => ({ ...x, state: s, city: '' }))} /></label>
        <label className="field"><span>City</span><CitySelect state={f.state} value={f.city} onChange={(c) => d.setForm((x) => ({ ...x, city: c }))} /></label>
        <label className="field"><span>Sampradaya</span>
          <select value={f.sect} onChange={set('sect')}><option value="">Not known</option><option value="digambar">Digambar</option><option value="shwetambar">Shwetambar</option></select>
        </label>
        <label className="field"><span>Interested in</span>
          <select value={f.interest} onChange={set('interest')}>
            <option value="unsure">Not sure yet</option><option value="online">Online</option><option value="offline">Offline</option><option value="both">Online + Offline</option>
          </select>
        </label>
      </div>
      <h4 className="form-section">Contact</h4>
      <div className="form-grid">
        <label className="field"><span>Name</span><input name="contact_name" value={f.contact_name} onChange={set('contact_name')} placeholder="Trustee / secretary" /></label>
        <label className="field"><span>Mobile</span><input name="mobile" inputMode="tel" value={f.mobile} onChange={set('mobile')} placeholder="98260 12345" /></label>
        <label className="field span-2"><span>Email</span><input name="email" type="email" value={f.email} onChange={set('email')} /></label>
      </div>
      <h4 className="form-section">Deal & follow-up</h4>
      <div className="form-grid">
        <label className="field"><span>Plan they are likely to take</span>
          <select value={f.expected_plan} onChange={set('expected_plan')}><option value="">Not known</option><option value="starter">Starter</option><option value="standard">Standard</option><option value="premium">Premium</option><option value="enterprise">Enterprise</option><option value="offline">JainERP Offline</option></select>
        </label>
        <label className="field"><span>Deal value (₹ / year, before GST)</span><input name="value" type="number" min={0} value={f.value} onChange={set('value')} placeholder="9999" /></label>
        <label className="field"><span>Source</span>
          <select value={f.source} onChange={set('source')}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label className="field"><span>Owner</span>
          <select value={f.owner_id} onChange={set('owner_id')}><option value="">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}</select>
        </label>
        <label className="field"><span>Next follow-up</span><input type="date" name="next_follow_up" value={f.next_follow_up} onChange={set('next_follow_up')} /></label>
        <label className="field span-2"><span>Notes</span><textarea rows={3} value={f.notes} onChange={set('notes')} placeholder="How we met them, what they need, who decides…" /></label>
      </div>
    </ActionForm>
  );
}

function LeadView({ id, team, onClose, onChanged, toast }: { id: string; team: TeamMember[]; onClose: () => void; onChanged: () => void; toast: (t: string, tone?: 'ok' | 'bad') => void }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [losing, setLosing] = useState(false);
  const canWork = useCan('enquiries.manage');
  const canOnboard = useCan('mandirs.onboard');
  const navigate = useNavigate();
  const load = useCallback(() => { api<Lead>(`/admin/leads/${id}`).then((r) => setLead(r.data)).catch(setError); }, [id]);
  useEffect(load, [load]);
  const note = useFormDraft(`lead-note:${id}`, { kind: 'call', body: '', next_follow_up: plusDays(3) });

  async function patch(body: Record<string, unknown>, msg: string) {
    try { const r = await api<Lead>(`/admin/leads/${id}`, { method: 'PATCH', body }); setLead(r.data); onChanged(); toast(msg); } catch (e) { setError(e); }
  }
  if (!lead) return <Modal title="Lead" onClose={onClose} wide confirmDiscard={false}><ErrorBox error={error} /><p className="muted">Loading…</p></Modal>;
  const closed = lead.stage === 'won' || lead.stage === 'lost';
  const stageIdx = STAGES.findIndex(([k]) => k === lead.stage);

  return (
    <Modal title={`${lead.reference} · ${lead.trust_name}`} onClose={onClose} wide confirmDiscard={false}>
      <ErrorBox error={error} />
      <div className="stepper" aria-label="Stage">
        {STAGES.filter(([k]) => k !== 'lost').map(([k, l], i) => (
          <button key={k} type="button" disabled={!canWork || closed} data-testid={`stage-${k}`}
            className={`st${lead.stage === k ? ' current' : i < stageIdx && lead.stage !== 'lost' ? ' done' : ''}`}
            onClick={() => (k === 'won' ? setOnboarding(true) : patch({ stage: k }, `Moved to ${l}.`))}>
            <span className="n">{i < stageIdx && lead.stage !== 'lost' ? '✓' : i + 1}</span>{l}
          </button>
        ))}
      </div>
      {lead.stage === 'lost' && <div className="notice"><span><b>Lost</b> — {lead.lost_reason}</span>{canWork && <button className="btn sm" onClick={() => patch({ stage: 'contacted' }, 'Reopened.')}>Reopen</button>}</div>}
      {lead.stage === 'won' && (
        <div className="success-box">Won — onboarded as {lead.tenant_id ? <Link to={`/mandirs/${lead.tenant_id}`}>{lead.tenant_name}</Link> : null}
          {lead.offline_mandir_id ? <> {lead.tenant_id ? '+ ' : ''}<Link to={`/offline-mandirs/${lead.offline_mandir_id}`}>{lead.offline_reference ?? 'offline record'}</Link></> : null}.</div>
      )}

      <div className="lead-grid">
        <section>
          <div className="review" style={{ gridTemplateColumns: '1fr' }}>
            <section>
              <h5>Details {canWork && <button type="button" onClick={() => setEditing(true)}>Edit</button>}</h5>
              <dl>
                <dt>Contact</dt><dd>{lead.contact_name ?? '—'}{lead.mobile ? <> · <a className="mono" href={`tel:${lead.mobile}`}>{lead.mobile}</a></> : null}{lead.mobile ? <> · <a href={`https://wa.me/${lead.mobile.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a></> : null}</dd>
                <dt>Email</dt><dd>{lead.email ?? '—'}</dd>
                <dt>Place</dt><dd>{[lead.city, lead.state].filter(Boolean).join(', ') || '—'}</dd>
                <dt>Interested in</dt><dd>{{ online: 'Online', offline: 'Offline', both: 'Online + Offline', unsure: 'Not sure yet' }[lead.interest]}{lead.sect ? ` · ${lead.sect}` : ''}</dd>
                <dt>Deal</dt><dd>{lead.expected_value_paise ? `${formatPaise(lead.expected_value_paise)} / year` : '—'}{lead.expected_plan ? ` · ${lead.expected_plan}` : ''}</dd>
                <dt>Owner</dt><dd>
                  {canWork && !closed ? (
                    <select aria-label="Owner" value={lead.owner_id ?? ''} onChange={(e) => patch({ owner_id: e.target.value || null }, 'Owner changed.')} style={{ maxWidth: 240 }}>
                      <option value="">Unassigned</option>{team.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.email}</option>)}
                    </select>
                  ) : lead.owner_name ?? 'Unassigned'}
                </dd>
                <dt>Follow-up</dt><dd><FollowUp l={lead} /></dd>
                <dt>Source</dt><dd>{SOURCE_LABEL[lead.source] ?? lead.source}</dd>
                <dt>Added</dt><dd>{formatDate(lead.created_at)}{lead.created_by_name ? ` by ${lead.created_by_name}` : ''}</dd>
              </dl>
              {lead.notes && <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: '10px 0 0' }}>{lead.notes}</p>}
            </section>
          </div>
          {canWork && !closed && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {canOnboard && <button className="btn primary" data-testid="lead-onboard" onClick={() => setOnboarding(true)}>Onboard this mandir</button>}
              <button className="btn" onClick={() => setLosing(true)}>Mark lost</button>
            </div>
          )}
          {/* Test or duplicate leads. A won lead is how a live mandir came in,
              so it is kept (the API refuses it too). */}
          {lead.stage !== 'won' && (
            <div style={{ marginTop: 12 }}>
              <DeleteEntryButton
                path={`/admin/leads/${lead.id}`}
                what={`lead ${lead.reference}`}
                note={lead.source.startsWith('website_') ? 'It came from a website request; that request is deleted with it, so it is not imported again.' : undefined}
                onDeleted={(m) => { onClose(); onChanged(); toast(m); }}
                onError={setError}
              />
            </div>
          )}
        </section>

        <section>
          {canWork && (
            <form className="log-form" onSubmit={async (e) => {
              e.preventDefault();
              if (!note.form.body.trim()) return;
              try {
                const r = await api<Lead>(`/admin/leads/${id}/activities`, { method: 'POST', body: { kind: note.form.kind, body: note.form.body, next_follow_up: closed ? undefined : (note.form.next_follow_up || null) } });
                note.clear(); note.discard(); setLead(r.data); onChanged(); toast('Logged.');
              } catch (err) { setError(err); }
            }}>
              <div className="seg" style={{ marginBottom: 8 }}>
                {KINDS.map(([k, l]) => <button key={k} type="button" className={note.form.kind === k ? 'active' : ''} onClick={() => note.setForm((x) => ({ ...x, kind: k }))}>{l}</button>)}
              </div>
              <textarea rows={3} data-testid="lead-log-body" placeholder="What was said, what was agreed, what happens next…" value={note.form.body} onChange={(e) => note.setForm((x) => ({ ...x, body: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                {!closed && <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>Next follow-up
                  <input type="date" value={note.form.next_follow_up} onChange={(e) => note.setForm((x) => ({ ...x, next_follow_up: e.target.value }))} style={{ width: 160 }} /></label>}
                <div style={{ flex: 1 }} />
                <button className="btn primary sm" type="submit" data-testid="lead-log" disabled={!note.form.body.trim()}>Log {KINDS.find(([k]) => k === note.form.kind)?.[1].toLowerCase()}</button>
              </div>
            </form>
          )}
          <h4 className="form-section" style={{ marginTop: 14 }}>Timeline</h4>
          <ol className="timeline" data-testid="lead-timeline">
            {(lead.activities ?? []).map((a) => (
              <li key={a.id} className={`k-${a.kind}`}>
                <div className="t-head"><b>{a.kind === 'stage' ? `${STAGE_LABEL[String(a.meta.from)] ?? a.meta.from} → ${STAGE_LABEL[String(a.meta.to)] ?? a.meta.to}` : KINDS.find(([k]) => k === a.kind)?.[1] ?? 'Update'}</b>
                  <span className="muted"> · {a.by_name ?? 'system'} · {new Date(a.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
                {a.body && <div className="t-body">{a.body}</div>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {editing && (
        <Modal title={`Edit ${lead.reference}`} onClose={() => setEditing(false)} wide confirmDiscard={false}>
          <LeadForm lead={lead} team={team} onDone={(l) => { setEditing(false); setLead({ ...lead, ...l }); load(); onChanged(); toast('Saved.'); }} />
        </Modal>
      )}
      {losing && (
        <Modal title="Mark lost" onClose={() => setLosing(false)}>
          <ActionForm submitLabel="Mark lost" successMessage={null} onSubmit={async () => {
            const reason = (document.querySelector('[name=lost_reason]') as HTMLSelectElement).value;
            const other = (document.querySelector('[name=lost_other]') as HTMLInputElement).value.trim();
            await patch({ stage: 'lost', lost_reason: reason === 'Other' ? other || 'Other' : reason }, 'Marked lost.');
            setLosing(false);
          }}>
            <label className="field"><span>Why?</span>
              <select name="lost_reason" defaultValue="Price"><option>Price</option><option>Chose another software</option><option>Not ready yet</option><option>No decision maker</option><option>Not reachable</option><option>Duplicate</option><option>Other</option></select>
            </label>
            <label className="field"><span>Detail (optional)</span><input name="lost_other" placeholder="Which software, what price…" /></label>
          </ActionForm>
        </Modal>
      )}
      {onboarding && (
        <OnboardingWizard
          prefill={{
            deployment: lead.interest === 'unsure' ? null : (lead.interest as 'online' | 'offline' | 'both'),
            form: { name: lead.trust_name, admin_name: lead.contact_name ?? '', admin_mobile: (lead.mobile ?? '').replace(/^\+91/, ''), admin_email: lead.email ?? '', state: lead.state ?? '', city: lead.city ?? '', sect: lead.sect ?? '', plan: ['starter', 'standard', 'premium', 'enterprise'].includes(lead.expected_plan ?? '') ? lead.expected_plan! : 'standard' },
          }}
          onClose={() => setOnboarding(false)}
          onCreated={async (r) => {
            setOnboarding(false);
            try {
              await api(`/admin/leads/${id}/convert`, { method: 'POST', body: { tenant_id: r.tenantId, offline_mandir_id: r.offlineId } });
              toast(`${lead.trust_name} onboarded — lead won.`);
            } catch (e) { setError(e); }
            onChanged();
            navigate(r.tenantId ? `/mandirs/${r.tenantId}` : `/offline-mandirs/${r.offlineId}`);
          }}
        />
      )}
    </Modal>
  );
}
