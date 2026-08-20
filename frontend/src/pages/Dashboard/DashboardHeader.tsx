import React from 'react';
import { Space, Typography, theme as antdTheme } from 'antd';
import { useUser } from '@clerk/react';
import dayjs from 'dayjs';

/** Time-of-day greeting (UXDS 9.5 Header — "Good Morning, {name}"). */
function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

/**
 * Dashboard page header (UXDS 9.5): title, greeting, and date.
 *
 * Reads the signed-in user's first name from the EXISTING Clerk setup
 * (read-only via useUser — no Clerk configuration is touched). The global
 * search / notifications / AI shortcut slots from the full spec are added
 * in later phases.
 */
const DashboardHeader: React.FC = () => {
  const { token } = antdTheme.useToken();
  const { user } = useUser();
  const now = dayjs();

  const firstName = user?.firstName;
  const greeting = greetingForHour(now.hour());
  const dateLabel = now.format('dddd • MMM D');

  return (
    <header aria-label="Dashboard header">
      <Space direction="vertical" size={4}>
        <Typography.Title
          level={2}
          style={{ margin: 0, color: token.colorText, fontWeight: 600 }}
        >
          Dashboard
        </Typography.Title>
        <Typography.Text style={{ color: token.colorText, fontSize: token.fontSizeLG }}>
          {greeting}
          {firstName ? `, ${firstName}` : ''} 👋
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {dateLabel}
        </Typography.Text>
      </Space>
    </header>
  );
};

export default DashboardHeader;
