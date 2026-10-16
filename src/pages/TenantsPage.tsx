import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileClock, Plus, Trash2 } from 'lucide-react';
import { api, formatDate, formatPaise, type ApiMeta } from '../api/client';
import type { DirectoryRow, OnboardingDraftRow } from '../api/types';
import { ErrorBox, Modal, Pagination, useToast } from '../components/ui';
import { EmptyRow, PageHeader } from '../components/PageHeader';
import { OnboardingWizard, hasOnboardingDraft } from '../components/OnboardingWizard';
import { LicenceBadge } from '../components/OfflineMandirFields';
import { useCan } from '../auth/permissions';

/**
 * Manage Mandir — every mandir in one list, however it runs JainERP: online
 * (cloud), offline (JainERP Offline only) or both (migration 094,
 * GET /admin/mandir-directory). Offline Mandirs used to be a separate page
 * with its own list and its own onboarding; it is folded in here.
 *
 * Filters live in the URL (?deployment=offline&view=attention…), so a view
 * can be bookmarked, shared, and survives the back button — the standard for
 * admin lists. Customers only by default; demo mandirs are a filter away.
 */

const PAGE = 25;
const DEPLOY_TABS: Array<[string, string]> = [['', 'All'], ['online', 'Online'], ['offline', 'Offline'], ['both', 'Online + Offline']];
const VIEWS: Array<[string, string]> = [
  ['all', 'All mandirs'], ['live', 'Live — usable today'], ['attention', 'Needs attention'],
  ['blocked', 'Blocked / paused'], ['deleted', 'Deleted (recycle bin)'],
];
const FILTER_KEYS = ['q', 'deployment', 'view', 'plan', 'licence', 'demo', 'devotee', 'custom_plan', 'dues', 'sort'] as const;

export function DeploymentPill({ value }: { value: string }) {
  const label = value === 'both' ? 'Online + Offline' : value[0].toUpperCase() + value.slice(1);
  return <span className={`dep ${value}`}>{label}</span>;
}

function StatusCell({ r }: { r: DirectoryRow }) {
  if (r.is_deleted) return <span className="badge">deleted</span>;
  if (r.source === 'offline') {
    return r.status === 'active' ? <span className="badge green">active</span> : <span className="badge">{r.status}</span>;
  }
  if (r.access_enabled) return <span className="badge green">active</span>;
  return (
    <span className="badge red" title={r.access_block_reason ?? undefined}>
      {r.status !== 'active' ? r.status : 'blocked'}{r.access_block_reason ? ` · ${r.access_block_reason.replace(/_/g, ' ')}` : ''}
    </span>
  );
}

export function TenantsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [meta, setMeta] = useState<(ApiMeta & { counts?: Record<string, number> }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(get('q'));
  const [plans, setPlans] = useState<Array<{ name: string; display_name: string }>>([]);
  const [drafts, setDrafts] = useState<OnboardingDraftRow[]>([]);
  const [wizard, setWizard] = useState<{ draftId: string | null } | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const toast = useToast();
  const canOnboard = useCan('mandirs.onboard');

  /**
   * Change filters; any change except paging goes back to page 1. Applied to
   * the LIVE address bar, never a copy captured earlier: the debounced search
   * fires 300 ms late and used to wipe a filter chosen in between. (React
   * Router 6's functional setSearchParams is no help — its "prev" is the copy
   * from the render that created the callback.)
   */
  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  // Newest request wins: a slower older response must not overwrite the rows.
  const seq = useRef(0);
  const load = useCallback(() => {
    const qs = new URLSearchParams({ page: String(page), limit: String(PAGE) });
    for (const k of FILTER_KEYS) { const v = params.get(k); if (v) qs.set(k, v); }
    const n = ++seq.current;
    setLoading(true);
    api<DirectoryRow[]>(`/admin/mandir-directory?${qs}`)
      .then((r) => { if (n === seq.current) { setRows(r.data); setMeta(r.meta as typeof meta); setError(null); } })
      .catch((e) => { if (n === seq.current) setError(e); })
      .finally(() => { if (n === seq.current) setLoading(false); });
  }, [params, page]);
  useEffect(load, [load]);

  const loadDrafts = useCallback(() => {
    api<OnboardingDraftRow[]>('/admin/onboarding-drafts').then((r) => setDrafts(r.data)).catch(() => setDrafts([]));
  }, []);
  useEffect(loadDrafts, [loadDrafts]);
  useEffect(() => {
    api<Array<{ name: string; display_name: string; is_active: boolean }>>('/admin/plans')
      .then((r) => setPlans(r.data.filter((p) => p.is_active))).catch(() => setPlans([]));
  }, []);
  // Debounced search into the URL.
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== get('q')) update({ q: search.trim() }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const counts = meta?.counts ?? {};
  const activeFilters = FILTER_KEYS.filter((k) => k !== 'deployment' && k !== 'sort' && k !== 'q' && params.get(k)).length + (get('q') ? 1 : 0);
  const open = (r: DirectoryRow) => navigate(r.source === 'offline' ? `/offline-mandirs/${r.id}` : `/mandirs/${r.id}`);

  async function deleteDraft(d: OnboardingDraftRow) {
    if (!window.confirm(`Delete the draft "${d.title || 'Untitled'}"? This cannot be undone.`)) return;
    try {
      await api(`/admin/onboarding-drafts/${d.id}`, { method: 'DELETE' });
      loadDrafts();
      toast.show('Draft deleted.');
    } catch (e) { toast.show(String((e as Error).message), 'bad'); }
  }

  return (
    <div>
      <PageHeader
        title="Manage Mandir"
        subtitle="Every mandir on JainERP — online, offline and both. Open one to manage its plan, users, billing or licence."
        actions={canOnboard &&
          <>
            <button className="btn" onClick={() => setShowDrafts(true)} data-testid="drafts-btn">
              <FileClock size={15} /> Drafts{drafts.length ? ` (${drafts.length})` : ''}
            </button>
            <button className="btn primary" data-testid="onboard-btn" onClick={() => setWizard({ draftId: null })}>
              {hasOnboardingDraft() ? 'Continue onboarding…' : <><Plus size={15} /> Onboard Mandir</>}
            </button>
          </>
        }
      />
      <ErrorBox error={error} />

      <div className="seg" role="tablist" aria-label="Deployment">
        {DEPLOY_TABS.map(([value, label]) => (
          <button key={value || 'all'} role="tab" aria-selected={get('deployment') === value}
            className={get('deployment') === value ? 'active' : ''} onClick={() => update({ deployment: value })}>
            {label}<span className="count">{counts[value || 'all'] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <input type="search" aria-label="Search" placeholder="Search name, slug, OFF- reference, city, contact or mobile…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="View" value={get('view') || 'all'} onChange={(e) => update({ view: e.target.value === 'all' ? '' : e.target.value })}>
          {VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select aria-label="Plan" value={get('plan')} onChange={(e) => update({ plan: e.target.value })}>
          <option value="">Any plan</option>
          {plans.map((p) => <option key={p.name} value={p.name}>{p.display_name}</option>)}
        </select>
        <select aria-label="Licence" value={get('licence')} onChange={(e) => update({ licence: e.target.value })}>
          <option value="">Any licence</option>
          <option value="active">Licence active</option><option value="expiring">Ends within 30 days</option>
          <option value="grace">In grace period</option><option value="expired">Expired</option><option value="none">No licence</option>
        </select>
        <select aria-label="More" value={get('dues') ? 'dues' : get('custom_plan') ? 'custom' : get('devotee') ? `dev-${get('devotee')}` : ''}
          onChange={(e) => {
            const v = e.target.value;
            update({ dues: v === 'dues' ? 'true' : '', custom_plan: v === 'custom' ? 'true' : '', devotee: v.startsWith('dev-') ? v.slice(4) : '' });
          }}>
          <option value="">More filters</option>
          <option value="dues">Money owed</option>
          <option value="custom">On a custom plan</option>
          <option value="dev-visible">Listed in devotee app</option>
          <option value="dev-hidden">Hidden from devotee app</option>
        </select>
        <select aria-label="Customers or demo" value={get('demo') || 'customers'} onChange={(e) => update({ demo: e.target.value === 'customers' ? '' : e.target.value })}>
          <option value="customers">Customers</option><option value="demo">Demo / test only</option><option value="all">Customers + demo</option>
        </select>
        <div className="grow" />
        <select aria-label="Sort" value={get('sort') || 'newest'} onChange={(e) => update({ sort: e.target.value === 'newest' ? '' : e.target.value })}>
          <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
          <option value="name">Name A–Z</option><option value="dues">Most owed</option>
        </select>
        {activeFilters > 0 && (
          <button type="button" className="clear" onClick={() => { setSearch(''); setParams(get('deployment') ? { deployment: get('deployment') } : {}, { replace: true }); }}>
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
      </div>

      <div className="result-line">
        <span>{loading ? 'Loading…' : `${meta?.total ?? 0} mandir${meta?.total === 1 ? '' : 's'}`}{get('demo') === 'demo' ? ' (demo / test)' : ''}</span>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Mandir</th>
              <th>Runs on</th>
              <th>Status</th>
              <th>Plan / licence</th>
              <th>Location</th>
              <th className="num">Owed</th>
              <th>Since</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.source}-${r.id}`} className="clickable dir-row" data-testid={`mandir-row-${r.code}`} onClick={() => open(r)}>
                <td>
                  <Link to={r.source === 'offline' ? `/offline-mandirs/${r.id}` : `/mandirs/${r.id}`} onClick={(e) => e.stopPropagation()}>
                    <strong>{r.name}</strong>
                  </Link>
                  {r.is_demo && <span className="badge demo" style={{ marginLeft: 6 }}>demo</span>}
                  <div className="sub mono">{r.code}{r.deployment === 'both' && r.offline_reference ? ` · ${r.offline_reference}` : ''}</div>
                </td>
                <td><DeploymentPill value={r.deployment} /></td>
                <td data-testid={`access-${r.code}`}>
                  <StatusCell r={r} />
                  {r.source === 'tenant' && (
                    <div className="sub" data-testid={`visible-${r.code}`}>{r.devotee_visible ? 'listed for devotees' : 'hidden from devotees'}</div>
                  )}
                </td>
                <td>
                  {r.plan && <div>{r.plan}{r.is_custom_plan && <span className="sub"> · custom price</span>}</div>}
                  {r.deployment !== 'online' && (
                    <div style={{ marginTop: r.plan ? 4 : 0 }}>
                      <LicenceBadge state={r.licence_state} days={r.licence_valid_until ? Math.floor((new Date(r.licence_valid_until).getTime() - Date.now()) / 86400000) : null} />
                    </div>
                  )}
                </td>
                <td>{[r.city, r.state].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                <td className="num">{r.dues_paise > 0 ? <b style={{ color: 'var(--color-danger)' }}>{formatPaise(r.dues_paise)}</b> : <span className="muted">—</span>}</td>
                <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(r.created_at)}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              activeFilters || get('deployment')
                ? <EmptyRow colSpan={7} title="No mandirs match these filters.">
                    <button className="btn sm" style={{ marginTop: 8 }} onClick={() => { setSearch(''); setParams({}, { replace: true }); }}>Clear filters</button>
                  </EmptyRow>
                : <EmptyRow colSpan={7} title="No mandirs yet.">Onboard the first one with <b>Onboard Mandir</b>.</EmptyRow>
            )}
          </tbody>
        </table>
      </div>
      {meta && <Pagination page={page} total={meta.total} limit={PAGE} onPage={(p) => update({ page: String(p) })} />}

      {showDrafts && (
        <Modal title="Onboarding drafts" onClose={() => setShowDrafts(false)} wide confirmDiscard={false}>
          <p className="muted" style={{ marginTop: 0 }}>Onboardings saved with <b>Save as draft</b>. Any super admin can finish one.</p>
          <table className="data">
            <thead><tr><th>Mandir</th><th>Runs on</th><th>Step</th><th>Last saved</th><th></th></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.title || 'Untitled'}</strong>{d.tenant_id && <div className="sub">online part already created</div>}</td>
                  <td><DeploymentPill value={d.deployment} /></td>
                  <td>{d.step + 1}</td>
                  <td>{new Date(d.updated_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}<div className="sub">{d.updated_by_name ?? d.created_by_name ?? ''}</div></td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="btn sm primary" onClick={() => { setShowDrafts(false); setWizard({ draftId: d.id }); }}>Continue</button>{' '}
                    <button className="btn sm" aria-label="Delete draft" title="Delete draft" onClick={() => deleteDraft(d)}><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
              {drafts.length === 0 && <EmptyRow colSpan={5} title="No saved drafts." />}
            </tbody>
          </table>
        </Modal>
      )}

      {wizard && (
        <OnboardingWizard
          draftId={wizard.draftId}
          onClose={() => { setWizard(null); loadDrafts(); }}
          onCreated={(r) => {
            setWizard(null);
            loadDrafts();
            toast.show('Mandir onboarded.');
            navigate(r.tenantId ? `/mandirs/${r.tenantId}` : `/offline-mandirs/${r.offlineId}`);
          }}
        />
      )}
      {toast.node}
    </div>
  );
}
