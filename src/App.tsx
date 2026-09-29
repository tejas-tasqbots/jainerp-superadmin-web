import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Compass, CopyCheck, FileText, Inbox, Landmark, LayoutDashboard, Library, LogOut, MessageSquareQuote, Package, Presentation, Settings as SettingsIcon, ShieldCheck, Sparkles, UserPlus, Users, Users2 } from 'lucide-react';
import { api } from './api/client';
import { useAuth } from './auth/AuthContext';
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
import { RegistrationsPage } from './pages/RegistrationsPage';
import { CustomRequestsPage } from './pages/CustomRequestsPage';
import { DemoRequestsPage } from './pages/DemoRequestsPage';
import { SectReadinessPage } from './pages/SectReadinessPage';
import { LibraryPage } from './pages/LibraryPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantsPage } from './pages/TenantsPage';

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
  queue?: string;
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
      {
        to: '/registrations', label: 'Registrations', icon: <UserPlus size={18} />,
        queue: '/admin/registrations?status=pending&limit=1',
      },
      {
        to: '/custom-requests', label: 'Custom Requests', icon: <MessageSquareQuote size={18} />,
        queue: '/admin/custom-requests?status=new',
      },
      {
        to: '/demo-requests', label: 'Demo Requests', icon: <Presentation size={18} />,
        queue: '/admin/demo-requests?status=new&limit=1',
      },
    ],
  },
  {
    heading: 'Platform',
    items: [
      { to: '/plans', label: 'Plans', icon: <Package size={18} /> },
      { to: '/sect-readiness', label: 'Sampradaya', icon: <Compass size={18} /> },
      // Platform content, like Sampradaya beside it - no temple owns the granth
      // catalogue, so no temple admin curates it.
      { to: '/library', label: 'Library', icon: <Library size={18} /> },
      { to: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
    ],
  },
];

function Layout() {
  const { session, logout } = useAuth();
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
      try {
        const r = await api<unknown[]>(item.queue!);
        const n = r.meta?.total ?? (Array.isArray(r.data) ? r.data.length : 0);
        return [item.to, Number(n) || 0] as const;
      } catch {
        return [item.to, 0] as const;
      }
    })).then((pairs) => {
      if (live) setCounts(Object.fromEntries(pairs));
    });
    return () => { live = false; };
  }, [location.pathname, tick]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Jain<em>ERP</em>
          <div className="brand-sub">Super Admin Console</div>
        </div>
        <nav>
          {navGroups.map((group, gi) => (
            <div key={group.heading ?? gi} className={gi ? 'mt-4' : ''}>
              {group.heading && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-white/40">
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
                      className="ml-auto flex-shrink-0 rounded-full bg-white/20 px-1.5 text-[10px] font-bold leading-4"
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
          <div className="name">{session?.user.name ?? session?.user.email}</div>
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
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/mandirs" element={<TenantsPage />} />
          <Route path="/mandirs/:id" element={<TenantDetailPage />} />
          <Route path="/devotees" element={<DevoteesPage />} />
          <Route path="/maharaj" element={<MaharajPage />} />
          <Route path="/sanghs" element={<SanghsPage />} />
          <Route path="/maharaj/duplicates" element={<DuplicatesPage />} />
          <Route path="/change-requests" element={<ChangeRequestsPage />} />
          <Route path="/template-approvals" element={<TemplateApprovalsPage />} />
          <Route path="/sant-content" element={<SantContentPage />} />
          <Route path="/donation-accounts" element={<DonationAccountsPage />} />
          <Route path="/registrations" element={<RegistrationsPage />} />
          <Route path="/custom-requests" element={<CustomRequestsPage />} />
          <Route path="/demo-requests" element={<DemoRequestsPage />} />
          <Route path="/plans" element={<PlansPage />} />
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
