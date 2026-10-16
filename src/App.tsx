import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Compass, CopyCheck, FileText, IndianRupee, Target, Inbox, Landmark, LayoutDashboard, Library, LogOut, Package, Settings as SettingsIcon, ShieldCheck, Sparkles, Users, Users2 } from 'lucide-react';
import { api } from './api/client';
import { useAuth } from './auth/AuthContext';
import { useMe } from './auth/permissions';
import { DashboardPage } from './pages/DashboardPage';
import { DevoteesPage } from './pages/DevoteesPage';
import { LoginPage } from './pages/LoginPage';
import { MaharajPage } from './pages/MaharajPage';
import { SanghsPage } from './pages/SanghsPage';
import { DuplicatesPage } from './pages/DuplicatesPage';
import { DonationAccountsPage } from './pages/DonationAccountsPage';
import { ChangeRequestsPage } from './pages/ChangeRequestsPage';
import { TemplateApprovalsPage } from './pages/TemplateApprovalsPage';
import { SantContentPage } from './pages/SantContentPage';
import { PlansPage } from './pages/PlansPage';
import { SectReadinessPage } from './pages/SectReadinessPage';
import { LibraryPage } from './pages/LibraryPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantsPage } from './pages/TenantsPage';
import { BillingPage } from './pages/BillingPage';
import { EnquiriesPage } from './pages/EnquiriesPage';
import { OfflineMandirDetailPage } from './pages/OfflineMandirDetailPage';

/**
 * The sidebar, in four groups.
 *
 * It was a flat list of sixteen, with seven review queues scattered through it:
 * Change Requests next to Duplicates, Donation Accounts between Sant Content and
 * Registrations, Demo Requests between Custom Requests and Plans. A reviewer
 * looking for "what needs me today" had to read the whole list and remember
 * which entries were queues.
 *
 * `queue` marks the ones that hold work, and carries the endpoint their count
 * comes from. That endpoint is the one the PAGE itself calls - so the badge and
 * the page can never disagree, and no new query had to be written to be wrong.
 */
interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
  /** A review queue: its badge counts what this endpoint returns. */
  queue?: string | string[];
}

const navGroups: { heading: string | null; items: NavItem[] }[] = [
  {
    heading: null,
    items: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, end: true },
    ],
  },
  {
    heading: 'Directory',
    items: [
      // Online, offline (JainERP Offline) and both, in one list (migration 094).
      { to: '/mandirs', label: 'Manage Mandir', icon: <Landmark size={18} /> },
      { to: '/devotees', label: 'Manage Devotees', icon: <Users size={18} /> },
      { to: '/maharaj', label: 'Sadhu-Sadhvi', icon: <Sparkles size={18} /> },
      // Directly under Sadhu-Sadhvi: a sangh is only ever curated with the
      // roster in mind, and membership itself is set from that page.
      { to: '/sanghs', label: 'Sanghs', icon: <Users2 size={18} /> },
    ],
  },
  {
    // The seven decisions a trust cannot make for itself, together. Grouping
    // them is the whole answer to "too much approval repitative things": the
    // badges show which ones are empty, and an empty queue never needs opening.
    heading: 'Needs review',
    items: [
      {
        to: '/change-requests', label: 'Change Requests', icon: <ShieldCheck size={18} />,
        queue: '/admin/change-requests?status=pending&limit=1',
      },
      {
        to: '/template-approvals', label: 'Receipt Designs', icon: <FileText size={18} />,
        queue: '/admin/template-approvals?status=pending&limit=1',
      },
      {
        // The cost of not looking here is a donor paying money into a
        // trustee's personal account.
        to: '/donation-accounts', label: 'Donation Accounts', icon: <Landmark size={18} />,
        queue: '/admin/donation-accounts?status=pending',
      },
      {
        to: '/sant-content', label: 'Sant Content', icon: <Inbox size={18} />,
        queue: '/admin/maharaj/pending-content',
      },
      {
        // Beside the roster it curates. 160 name-and-rank groups hold more than
        // one profile, and until recently nothing in the console showed them.
        to: '/maharaj/duplicates', label: 'Duplicates', icon: <CopyCheck size={18} /> },
    ],
  },
  {
    // Leads, not approvals. They look like queues and are not: nobody is
    // waiting on a decision, somebody is waiting on a call.
    heading: 'Enquiries',
    items: [
      // Leads, registrations, custom-plan and demo requests: one job, one page
      // with a tab each (pages/EnquiriesPage.tsx). The badge is everything
      // waiting across them.
      {
        to: '/leads', label: 'Leads & Enquiries', icon: <Target size={18} />,
        queue: ['/admin/leads?due=overdue&limit=1', '/admin/registrations?status=pending&limit=1', '/admin/custom-requests?status=new', '/admin/demo-requests?status=new&limit=1'],
      },
    ],
  },
  {
    // Money in one place: receivables, renewals, and the price list.
    heading: 'Revenue',
    items: [
      { to: '/billing', label: 'Billing', icon: <IndianRupee size={18} /> },
      { to: '/plans', label: 'Plans', icon: <Package size={18} /> },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { to: '/sect-readiness', label: 'Sampradaya', icon: <Compass size={18} /> },
      // Platform content, like Sampradaya beside it - no temple owns the granth
      // catalogue, so no temple admin curates it.
      { to: '/library', label: 'Library', icon: <Library size={18} /> },
      { to: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
    ],
  },
];

/**
 * Find a mandir from anywhere — the search box at the top of the sidebar, the
 * way Stripe and Shopify admins put search first. Press "/" to jump to it.
 * It opens Manage Mandir filtered by what was typed (name, slug, OFF-
 * reference, city, contact or mobile).
 */
function QuickFind() {
  const navigate = useNavigate();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      e.preventDefault();
      ref.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <form className="quickfind" role="search" onSubmit={(e) => {
      e.preventDefault();
      const v = q.trim();
      navigate(v ? `/mandirs?q=${encodeURIComponent(v)}&demo=all` : '/mandirs');
      setQ('');
      ref.current?.blur();
    }}>
      <input ref={ref} type="search" aria-label="Find a mandir" placeholder="Find a mandir…   /" value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

function Layout() {
  const { session, logout } = useAuth();
  const me = useMe();
  const navigate = useNavigate();
  /**
   * How many items are waiting in each review queue, keyed by its route.
   *
   * Fetched from the endpoint each PAGE already calls, deliberately. A
   * purpose-built counts endpoint was written first and four of its eight
   * tables and status filters were guesses — a badge that is wrong about a queue
   * is worse than no badge, because it sends somebody to look at nothing or
   * stops them looking at something. Reusing the page's own query cannot
   * disagree with what the page will show.
   *
   * `meta.total` when the endpoint pages (so `limit=1` fetches one row and the
   * real count), otherwise the array length. A queue that errors simply has no
   * badge; the sidebar is on every screen and must not be able to break one.
   *
   * A badge counts work still WAITING (a demo request still "new", a change
   * request still pending) — it clears when the item is acted on, not when it
   * is looked at, like any review queue. It was fetched once, when the console
   * opened, so a request handled a minute ago kept its badge until a full
   * reload (reported 2026-09-29: "why this number if I already viewed").
   * Now it re-reads on every page change, when the tab comes back into focus,
   * and once a minute.
   */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const location = useLocation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
    window.addEventListener('focus', bump);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(bump, 60_000);
    return () => {
      window.removeEventListener('focus', bump);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const queues = navGroups.flatMap((g) => g.items).filter((i) => i.queue);
    void Promise.all(queues.map(async (item) => {
      const sources = Array.isArray(item.queue) ? item.queue : [item.queue!];
      const ns = await Promise.all(sources.map(async (q) => {
        try {
          const r = await api<unknown[]>(q);
          return Number(r.meta?.total ?? (Array.isArray(r.data) ? r.data.length : 0)) || 0;
        } catch {
          return 0;
        }
      }));
      return [item.to, ns.reduce((a, b) => a + b, 0)] as const;
    })).then((pairs) => {
      if (live) setCounts(Object.fromEntries(pairs));
    });
    return () => { live = false; };
  }, [location.pathname, tick]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.svg" alt="JainERP" className="brand-logo" />
          <div className="brand-sub">Super Admin Console</div>
        </div>
        <QuickFind />
        <nav>
          {navGroups.map((group, gi) => (
            <div key={group.heading ?? gi} className={gi ? 'mt-4' : ''}>
              {group.heading && (
                <p className="nav-heading">
                  {group.heading}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                  {/* Only when there is something. A "0" beside every queue is
                      the same noise as no number at all — the point is that an
                      empty queue looks empty from here and never needs opening. */}
                  {!!item.queue && (counts[item.to] ?? 0) > 0 && (
                    <span
                      className="nav-count"
                      title={`${counts[item.to]} waiting for action — clears when handled, not when viewed`}
                    >
                      {counts[item.to]}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="whoami">
          <div className="name">{me?.name ?? session?.user.name ?? session?.user.email}</div>
          {me && <div className="role" data-testid="my-role">{me.role_label}</div>}
          <a
            href="#logout"
            className="inline-flex items-center gap-1.5 mt-1.5"
            onClick={async (e) => {
              e.preventDefault();
              await logout();
              navigate('/login');
            }}
          >
            <LogOut size={13} /> Sign out
          </a>
        </div>
      </aside>
      <main className="main">
        {/* A Viewer is told once, up front, rather than finding out button by button. */}
        {me?.role === 'viewer' && (
          <div className="notice" role="status" data-testid="viewer-banner" style={{ marginBottom: 16 }}>
            <span>You have <b>view-only</b> access — you can see everything but change nothing. Ask a Super admin if you need more.</span>
          </div>
        )}
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/mandirs" element={<TenantsPage />} />
          <Route path="/mandirs/:id" element={<TenantDetailPage />} />
          {/* Offline Mandirs is now a tab of Manage Mandir; old links still land. */}
          <Route path="/offline-mandirs" element={<Navigate to="/mandirs?deployment=offline" replace />} />
          <Route path="/offline-mandirs/:id" element={<OfflineMandirDetailPage />} />
          <Route path="/devotees" element={<DevoteesPage />} />
          <Route path="/maharaj" element={<MaharajPage />} />
          <Route path="/sanghs" element={<SanghsPage />} />
          <Route path="/maharaj/duplicates" element={<DuplicatesPage />} />
          <Route path="/change-requests" element={<ChangeRequestsPage />} />
          <Route path="/template-approvals" element={<TemplateApprovalsPage />} />
          <Route path="/sant-content" element={<SantContentPage />} />
          <Route path="/donation-accounts" element={<DonationAccountsPage />} />
          {/* One page now (Leads & Enquiries); the old addresses land on their tab. */}
          <Route path="/registrations" element={<Navigate to="/leads?tab=registrations" replace />} />
          <Route path="/custom-requests" element={<Navigate to="/leads?tab=custom" replace />} />
          <Route path="/demo-requests" element={<Navigate to="/leads?tab=demo" replace />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/billing" element={<BillingPage />} />
          <Route path="/leads" element={<EnquiriesPage />} />
          <Route path="/sect-readiness" element={<SectReadinessPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/*" element={session ? <Layout /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
