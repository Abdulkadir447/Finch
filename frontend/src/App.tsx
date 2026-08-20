import React, { useState, useEffect } from 'react';
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
// Protected Route Component using Clerk auth
// ---------------------------------------------------------------------------
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isSignedIn } = useAuth();
  return isSignedIn ? <>{children}</> : <Navigate to="/sign-in" replace />;
};

// ---------------------------------------------------------------------------
// Sign In Page using Clerk
// ---------------------------------------------------------------------------
const SignInPage = () => {
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

// Placeholder Pages
const Settings: React.FC = () => (
  <div>
    <h2>Settings</h2>
    <p>Settings will be displayed here.</p>
  </div>
);

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
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/" element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/products" element={<ProductsPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/orders" element={<OrdersPage />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  );
};

export default App;