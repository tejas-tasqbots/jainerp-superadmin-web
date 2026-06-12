import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { DevoteesPage } from './pages/DevoteesPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { TenantDetailPage } from './pages/TenantDetailPage';
import { TenantsPage } from './pages/TenantsPage';

function Layout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">Jain<em>ERP</em></div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/mandirs">Manage Mandir</NavLink>
          <NavLink to="/devotees">Manage Devotees</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <div className="spacer" />
        <div className="whoami">
          {session?.user.name ?? session?.user.email}
          <br />
          <a
            href="#logout"
            onClick={async (e) => {
              e.preventDefault();
              await logout();
              navigate('/login');
            }}
          >
            Sign out
          </a>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/mandirs" element={<TenantsPage />} />
          <Route path="/mandirs/:id" element={<TenantDetailPage />} />
          <Route path="/devotees" element={<DevoteesPage />} />
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
      <Route path="/*" element={session ? <Layout /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}
