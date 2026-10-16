import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { LeadsPage } from './LeadsPage';
import { RegistrationsPage } from './RegistrationsPage';
import { CustomRequestsPage } from './CustomRequestsPage';
import { DemoRequestsPage } from './DemoRequestsPage';

/**
 * Leads & Enquiries — one place for everyone who might become a mandir:
 *
 *   Leads            the pipeline we work (added by hand or pulled in below)
 *   Registrations    trusts that signed up on the website themselves
 *   Custom requests  "we need something not in the plans"
 *   Demo requests    "show us JainERP"
 *
 * They were four sidebar entries; they are one job. Each tab is the page it
 * always was, so nothing about working a registration or a demo changed — the
 * count on each tab says where something is waiting.
 */
const TABS: Array<{ key: string; label: string; queue: string; hint: string }> = [
  { key: 'leads', label: 'Leads', queue: '/admin/leads?due=overdue&limit=1', hint: 'follow-ups overdue' },
  { key: 'registrations', label: 'Registrations', queue: '/admin/registrations?status=pending&limit=1', hint: 'waiting' },
  { key: 'custom', label: 'Custom requests', queue: '/admin/custom-requests?status=new', hint: 'new' },
  { key: 'demo', label: 'Demo requests', queue: '/admin/demo-requests?status=new&limit=1', hint: 'new' },
];

export function EnquiriesPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab')! : 'leads';
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    void Promise.all(TABS.map(async (t) => {
      try {
        const r = await api<unknown[]>(t.queue);
        return [t.key, Number(r.meta?.total ?? (Array.isArray(r.data) ? r.data.length : 0)) || 0] as const;
      } catch { return [t.key, 0] as const; }
    })).then((pairs) => { if (live) setCounts(Object.fromEntries(pairs)); });
    return () => { live = false; };
  }, [tab]);

  return (
    <div>
      <div className="seg enquiry-tabs" role="tablist" aria-label="Leads and enquiries" data-testid="enquiry-tabs">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'active' : ''}
            title={counts[t.key] ? `${counts[t.key]} ${t.hint}` : undefined}
            onClick={() => setParams(t.key === 'leads' ? {} : { tab: t.key }, { replace: false })}>
            {t.label}{counts[t.key] ? <span className="count attn">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>
      {tab === 'leads' && <LeadsPage />}
      {tab === 'registrations' && <RegistrationsPage />}
      {tab === 'custom' && <CustomRequestsPage />}
      {tab === 'demo' && <DemoRequestsPage />}
    </div>
  );
}
