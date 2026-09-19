import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Compass, CopyCheck, FileText, Inbox, Landmark, LayoutDashboard, Library, LogOut, MessageSquareQuote, Package, Presentation, Settings as SettingsIcon, ShieldCheck, Sparkles, UserPlus, Users, Users2 } from 'lucide-react';
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

const navItems = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, end: true },
  { to: '/mandirs', label: 'Manage Mandir', icon: <Landmark size={18} /> },
  { to: '/devotees', label: 'Manage Devotees', icon: <Users size={18} /> },
  { to: '/maharaj', label: 'Sadhu-Sadhvi', icon: <Sparkles size={18} /> },
  // Directly under Sadhu-Sadhvi: a sangh is only ever curated with the roster
  // in mind, and membership itself is set from that page.
  { to: '/sanghs', label: 'Sanghs', icon: <Users2 size={18} /> },
  // Beside the roster it curates. 160 name-and-rank groups hold more than
  // one profile, and until now nothing in the console showed them.
  { to: '/maharaj/duplicates', label: 'Duplicates', icon: <CopyCheck size={18} /> },
  { to: '/change-requests', label: 'Change Requests', icon: <ShieldCheck size={18} /> },
  { to: '/template-approvals', label: 'Receipt Designs', icon: <FileText size={18} /> },
  { to: '/sant-content', label: 'Sant Content', icon: <Inbox size={18} /> },
  // Sits beside Change Requests because it is the same job: approving something
  // a trust cannot approve for itself, where the cost of not looking is a donor
  // paying money into the wrong account.
  { to: '/donation-accounts', label: 'Donation Accounts', icon: <Landmark size={18} /> },
  { to: '/registrations', label: 'Registrations', icon: <UserPlus size={18} /> },
  { to: '/custom-requests', label: 'Custom Requests', icon: <MessageSquareQuote size={18} /> },
  // The third lead queue, beside the other two: the website's "Request a demo".
  { to: '/demo-requests', label: 'Demo Requests', icon: <Presentation size={18} /> },
  { to: '/plans', label: 'Plans', icon: <Package size={18} /> },
  { to: '/sect-readiness', label: 'Sampradaya', icon: <Compass size={18} /> },
  // Platform content, like Sampradaya beside it — no temple owns the granth
  // catalogue, so no temple admin curates it.
  { to: '/library', label: 'Library', icon: <Library size={18} /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon size={18} /> },
];

function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          Jain<em>ERP</em>
          <div className="brand-sub">Super Admin Console</div>
        </div>
        <nav>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="flex-shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </NavLink>
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
