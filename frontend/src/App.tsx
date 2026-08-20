import React, { useState, useEffect, useRef } from 'react';
import { ConfigProvider, Layout, Avatar, Space, Switch, Typography, Spin } from 'antd';
import { BulbOutlined, BulbFilled, DashboardOutlined, ShoppingCartOutlined, InboxOutlined, UserOutlined, TeamOutlined, SettingOutlined, LogoutOutlined, SearchOutlined, RobotOutlined } from '@ant-design/icons';
import { Menu } from 'antd';
import { theme as finchTheme, brand, neutral } from './theme';
import 'antd/dist/reset.css';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, useUser, useClerk, SignIn, SignUp } from '@clerk/react';
import { message } from 'antd';
import DashboardPage from './pages/Dashboard';
import ProductsPage from './pages/Products';
import InventoryPage from './pages/Inventory';
import CustomersPage from './pages/Customers';
import OrdersPage from './pages/Orders';
import SettingsPage from './pages/Settings';
import NotFoundPage from './pages/NotFound';
import { setCurrency } from './services/currency';
import { useApiClient } from './services/api/client';

const { Header, Content, Sider } = Layout;
const { Title } = Typography;

// Primary navigation (UXDS Ch1.14). Centralised so the sidebar, command palette,
// and routing stay in sync from a single source of truth.
const NAV_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard', path: '/' },
  { key: 'products', icon: <ShoppingCartOutlined />, label: 'Products', path: '/products' },
  { key: 'inventory', icon: <InboxOutlined />, label: 'Inventory', path: '/inventory' },
  { key: 'customers', icon: <UserOutlined />, label: 'Customers', path: '/customers' },
  { key: 'orders', icon: <TeamOutlined />, label: 'Orders', path: '/orders' },
  { key: 'settings', icon: <SettingOutlined />, label: 'Settings', path: '/settings' },
];

// ---------------------------------------------------------------------------
// Splash Screen (AFD Ch1.10 — lifecycle: Launch -> Splash -> Login)
// ---------------------------------------------------------------------------
const SplashScreen: React.FC = () => (
  <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: neutral[50] }}>
    <Title level={1} style={{ color: brand.primary, margin: 0 }}>Finch</Title>
    <Space>
      <Avatar icon={<RobotOutlined />} size={24} style={{ backgroundColor: neutral[100], color: brand.primary }} />
      <Typography.Text type="secondary">Your Business, Smarter.</Typography.Text>
    </Space>
    <Spin size="large" />
  </div>
);

// ---------------------------------------------------------------------------
// Full-screen loader shown while Clerk resolves the session. Auth state must
// NEVER be evaluated before `isLoaded` — redirecting on unresolved state is
// what caused the / <-> /sign-in redirect loop.
// ---------------------------------------------------------------------------
const AuthLoadingScreen: React.FC = () => (
  <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: neutral[50] }}>
    <Spin size="large" />
  </div>
);

// ---------------------------------------------------------------------------
// Protected Route Component using Clerk auth
// ---------------------------------------------------------------------------
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isLoaded, isSignedIn } = useAuth();
  // Wait for Clerk to resolve before evaluating the session (Clerk docs:
  // isSignedIn is undefined until isLoaded is true).
  if (!isLoaded) return <AuthLoadingScreen />;
  return isSignedIn ? <>{children}</> : <Navigate to="/sign-in" replace />;
};

// ---------------------------------------------------------------------------
// Sign In Page using Clerk
// ---------------------------------------------------------------------------
const SignInPage = () => {
  const { isLoaded, isSignedIn } = useAuth();
  // While Clerk resolves, hold the route — never bounce on unresolved state.
  if (!isLoaded) return <AuthLoadingScreen />;
  // Already authenticated: leave /sign-in exactly once, deterministically.
  if (isSignedIn) return <Navigate to="/" replace />;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <SignIn />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Sign Up Page using Clerk
// ---------------------------------------------------------------------------
const SignUpPage: React.FC = () => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <SignUp afterSignOutUrl="/" fallbackRedirectUrl="/" />
    </div>
  );
};

/**
 * Session-expiry guard (Task 11 / audit H6).
 *
 * The API client dispatches a `finch:unauthorized` event whenever the backend
 * rejects a request with 401 (session expired/revoked — a case Clerk's normal
 * token refresh does not cover). This component signs the user out exactly
 * once in response, after which Clerk's state flips to signed-out and the
 * ProtectedRoute deterministically navigates to /sign-in. The `handled` ref is
 * the loop guard: repeated 401s cannot trigger repeated sign-outs or a
 * sign-in <-> redirect bounce.
 */
const SessionExpiryGuard: React.FC = () => {
  const { signOut } = useClerk();
  const handled = useRef(false);

  useEffect(() => {
    const onUnauthorized = () => {
      if (handled.current) return;
      handled.current = true;
      signOut().catch(() => undefined);
    };
    window.addEventListener('finch:unauthorized', onUnauthorized);
    return () => window.removeEventListener('finch:unauthorized', onUnauthorized);
  }, [signOut]);

  return null;
};

/**
 * Seeds the app-wide currency store from the caller's business settings
 * (Task 9) so money formatting follows the company setting. Runs once per
 * signed-in session inside the protected layout; failures are silent.
 */
const CurrencySeeder: React.FC = () => {
  const api = useApiClient();
  useEffect(() => {
    let cancelled = false;
    api
      .get('/business/settings')
      .then((r) => !cancelled && setCurrency(r.data.currency))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [api]);
  return null;
};

// Main App Layout
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [darkMode, setDarkMode] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();

  const toggleTheme = (checked: boolean) => setDarkMode(checked);

  const handleLogout = async () => {
    await signOut();
    message.info('Logged out successfully');
  };

  const selectedKey =
    NAV_ITEMS.find((i) => i.path === location.pathname)?.key ?? 'dashboard';

  // Extract user info for display
  const userName = user?.fullName || user?.firstName || 'User';
  const userImage = user?.imageUrl || '';

  return (
    <ConfigProvider theme={darkMode ? finchTheme.dark : finchTheme.light}>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ background: neutral[950], display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px', borderBottom: `1px solid ${neutral[800]}` }}>
          <Title level={3} style={{ color: neutral[100], margin: 0 }}>Finch</Title>
          <Space>
            <BulbOutlined style={{ color: neutral[100] }} />
            <Switch checked={darkMode} onChange={toggleTheme} checkedChildren="Dark" unCheckedChildren="Light" />
            <BulbFilled style={{ color: '#ffec3d' }} />
            <Avatar src={userImage} alt={userName} />
            <LogoutOutlined style={{ cursor: 'pointer', color: neutral[100] }} onClick={handleLogout} />
          </Space>
        </Header>
        <Layout>
          <Sider
            width={220}
            collapsedWidth={80}
            collapsed={collapsed}
            collapsible
            onMouseEnter={() => setCollapsed(false)}
            onMouseLeave={() => setCollapsed(true)}
            style={{ background: neutral[950], borderRight: `1px solid ${neutral[800]}` }}
          >
            <Menu
              mode="inline"
              inlineCollapsed={collapsed}
              selectedKeys={[selectedKey]}
              style={{ height: '100%', borderRight: 0 }}
              items={NAV_ITEMS.map((i) => ({
                key: i.key,
                icon: i.icon,
                label: i.label,
                onClick: () => navigate(i.path),
              }))}
            />
          </Sider>
          <Content style={{ padding: '24px', minHeight: 'calc(100vh - 64px)' }}>{children}</Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
};

// Main App Component
const App: React.FC = () => {
  const [booting, setBooting] = useState(true);

  // Splash screen on launch (AFD Ch1.10 lifecycle).
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1200);
    return () => clearTimeout(t);
  }, []);

  if (booting) return <SplashScreen />;

  return (
    <BrowserRouter>
      <SessionExpiryGuard />
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <CurrencySeeder />
            <AppLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
};

export default App;