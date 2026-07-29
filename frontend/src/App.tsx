import React, { useState, useEffect, useMemo } from 'react';
import {
  ConfigProvider, Layout, Switch, Avatar, Typography, Space, Menu,
  Modal, Input, List, Drawer, FloatButton, Spin,
} from 'antd';
import {
  BulbOutlined, BulbFilled, DashboardOutlined, ShoppingCartOutlined,
  UserOutlined, TeamOutlined, SettingOutlined, LogoutOutlined,
  SearchOutlined, RobotOutlined,
} from '@ant-design/icons';
import { theme as finchTheme, brand, neutral } from './theme';
import 'antd/dist/reset.css';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { message } from 'antd';

const { Header, Content, Footer, Sider } = Layout;
const { Title, Text } = Typography;

// Primary navigation (UXDS Ch1.14). Centralised so the sidebar, command palette,
// and routing stay in sync from a single source of truth.
const NAV_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard', path: '/' },
  { key: 'products', icon: <ShoppingCartOutlined />, label: 'Products', path: '/products' },
  { key: 'customers', icon: <UserOutlined />, label: 'Customers', path: '/customers' },
  { key: 'orders', icon: <TeamOutlined />, label: 'Orders', path: '/orders' },
  { key: 'settings', icon: <SettingOutlined />, label: 'Settings', path: '/settings' },
];

// ---------------------------------------------------------------------------
// Splash Screen (AFD Ch1.10 — lifecycle: Launch -> Splash -> Login)
// ---------------------------------------------------------------------------
const SplashScreen: React.FC = () => (
  <div
    style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      background: neutral[50],
    }}
  >
    <Title level={1} style={{ color: brand.primary, margin: 0 }}>Finch</Title>
    <Text type="secondary">Your Business, Smarter.</Text>
    <Spin size="large" />
  </div>
);

// ---------------------------------------------------------------------------
// Command Palette (UXDS Ch1.14 — Ctrl+K, universal jump)
// ---------------------------------------------------------------------------
const CommandPalette: React.FC<{
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}> = ({ open, onClose, onNavigate }) => {
  const [q, setQ] = useState('');
  const results = useMemo(
    () => NAV_ITEMS.filter((i) => i.label.toLowerCase().includes(q.toLowerCase())),
    [q],
  );
  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Command Palette" width={560}>
      <Input
        prefix={<SearchOutlined />}
        placeholder="Jump to a module…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <List
        style={{ marginTop: 12 }}
        dataSource={results}
        renderItem={(item) => (
          <List.Item
            style={{ cursor: 'pointer', borderRadius: 8 }}
            onClick={() => { onNavigate(item.path); onClose(); }}
          >
            <Space>
              <span style={{ color: brand.primary }}>{item.icon}</span>
              <span>{item.label}</span>
            </Space>
          </List.Item>
        )}
      />
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// AI Assistant — floating, accessible from anywhere (UXDS Ch1.15)
// Wired structurally to the backend AIService (OpenAI Responses API); the
// conversation transport is connected in a later chapter.
// ---------------------------------------------------------------------------
const AIAssistant: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        tooltip="AI Assistant"
        style={{ insetInlineEnd: 24, insetBlockEnd: 24 }}
        onClick={() => setOpen(true)}
      />
      <Drawer title="Finch AI Assistant" open={open} onClose={() => setOpen(false)} width={380}>
        <Text type="secondary">
          Ask about your business. The assistant uses the backend AIService
          (OpenAI Responses API) and respects your local data and permissions.
          Conversation transport is connected in a later chapter.
        </Text>
      </Drawer>
    </>
  );
};

// Protected Route Component
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
};

// Main App Layout
const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [darkMode, setDarkMode] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);

  const toggleTheme = (checked: boolean) => setDarkMode(checked);

  const handleLogout = () => {
    logout();
    message.info('Logged out successfully');
  };

  // Command Palette shortcut: Ctrl+K (UXDS Ch1.14)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selectedKey =
    NAV_ITEMS.find((i) => i.path === location.pathname)?.key ?? 'dashboard';

  return (
    <ConfigProvider theme={darkMode ? finchTheme.dark : finchTheme.light}>
      <Layout style={{ minHeight: '100vh' }}>
        <Header
          style={{
            background: darkMode ? neutral[950] : neutral[0],
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0 24px', borderBottom: `1px solid ${darkMode ? neutral[800] : neutral[100]}`,
          }}
        >
          <Title level={3} style={{ color: darkMode ? neutral[100] : neutral[800], margin: 0 }}>
            Finch
          </Title>
          <Space>
            <BulbOutlined style={{ color: darkMode ? neutral[100] : neutral[800] }} />
            <Switch checked={darkMode} onChange={toggleTheme} checkedChildren="Dark" unCheckedChildren="Light" />
            <BulbFilled style={{ color: darkMode ? '#ffec3d' : brand.primary }} />
            <Avatar src="" alt="User" />
            <LogoutOutlined
              style={{ cursor: 'pointer', color: darkMode ? neutral[100] : neutral[800] }}
              onClick={handleLogout}
            />
          </Space>
        </Header>
        <Layout>
          {/* Collapsible icon sidebar — expands on hover (UXDS Ch1.14) */}
          <Sider
            width={220}
            collapsedWidth={80}
            collapsed={collapsed}
            collapsible
            onMouseEnter={() => setCollapsed(false)}
            onMouseLeave={() => setCollapsed(true)}
            style={{
              background: darkMode ? neutral[950] : neutral[0],
              borderRight: `1px solid ${darkMode ? neutral[800] : neutral[100]}`,
            }}
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
          <Content style={{ padding: '24px', minHeight: 'calc(100vh - 64px)' }}>
            {children}
          </Content>
        </Layout>
      </Layout>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={navigate} />
      <AIAssistant />
    </ConfigProvider>
  );
};

// Placeholder Pages
const Dashboard: React.FC = () => (
  <div>
    <h2>Dashboard</h2>
    <p>Dashboard analytics will be displayed here.</p>
  </div>
);

const Products: React.FC = () => (
  <div>
    <h2>Products</h2>
    <p>Product management will be displayed here.</p>
  </div>
);

const Customers: React.FC = () => (
  <div>
    <h2>Customers</h2>
    <p>Customer management will be displayed here.</p>
  </div>
);

const Orders: React.FC = () => (
  <div>
    <h2>Orders</h2>
    <p>Order management will be displayed here.</p>
  </div>
);

const Settings: React.FC = () => (
  <div>
    <h2>Settings</h2>
    <p>Settings will be displayed here.</p>
  </div>
);

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const handleLogin = async () => {
    try {
      await login('admin@example.com', 'password');
      message.success('Login successful');
      navigate('/');
    } catch (error) {
      message.error('Login failed');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <button onClick={handleLogin}>Login as Admin</button>
    </div>
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
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/products" element={<Products />} />
                <Route path="/customers" element={<Customers />} />
                <Route path="/orders" element={<Orders />} />
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
