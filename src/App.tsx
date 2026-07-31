import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Landmark, Users, Sparkles, Package, Settings as SettingsIcon, ShieldCheck, LogOut } from 'lucide-react';
import { useAuth } from './auth/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { DevoteesPage } from './pages/DevoteesPage';
import { LoginPage } from './pages/LoginPage';
import { MaharajPage } from './pages/MaharajPage';
import { ChangeRequestsPage } from './pages/ChangeRequestsPage';
import { PlansPage } from './pages/PlansPage';
import { SetPasswordPage } from './pages/SetPasswordPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantsPage } from './pages/TenantsPage';

const navItems = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, end: true },
  { to: '/mandirs', label: 'Manage Mandir', icon: <Landmark size={18} /> },
  { to: '/devotees', label: 'Manage Devotees', icon: <Users size={18} /> },
  { to: '/maharaj', label: 'Maharaj / Mataji', icon: <Sparkles size={18} /> },
  { to: '/change-requests', label: 'Change Requests', icon: <ShieldCheck size={18} /> },
  { to: '/plans', label: 'Plans', icon: <Package size={18} /> },
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
          <Route path="/change-requests" element={<ChangeRequestsPage />} />
          <Route path="/plans" element={<PlansPage />} />
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
