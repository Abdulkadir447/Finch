import React, { useState } from 'react';
import { ConfigProvider, Layout, Switch, Avatar, Typography, Space } from 'antd';
import { BulbOutlined, BulbFilled } from '@ant-design/icons';
import { theme } from './theme';
import 'antd/dist/reset.css';

const { Header, Content, Footer } = Layout;
const { Title } = Typography;

const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(false);

  const toggleTheme = (checked: boolean) => {
    setDarkMode(checked);
  };

  return (
    <ConfigProvider theme={darkMode ? theme.dark : theme.light}>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ background: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Title level={3} style={{ color: darkMode ? '#fff' : '#000', margin: 0 }}>
            ERP System
          </Title>
          <Space>
            <BulbOutlined style={{ color: darkMode ? '#fff' : '#000' }} />
            <Switch checked={darkMode} onChange={toggleTheme} checkedChildren="Dark" unCheckedChildren="Light" />
            <BulbFilled style={{ color: darkMode ? '#ffec3d' : '#000' }} />
            <Avatar src="" alt="User" />
          </Space>
        </Header>
        <Content style={{ padding: '24px' }}>
          <Title level={2}>Welcome to the ERP Dashboard</Title>
          <p>This is a placeholder UI built with Ant Design. Extend it with your components.</p>
        </Content>
        <Footer style={{ textAlign: 'center' }}>ERP System © 2026</Footer>
      </Layout>
    </ConfigProvider>
  );
};

export default App;
