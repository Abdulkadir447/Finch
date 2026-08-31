/**
 * Settings → Notifications. Gates the IN-APP notification center only —
 * these toggles do not invent an email/push channel that does not exist in
 * v1. Prefs are stored on the device and the TopBar notification center
 * honours them live.
 */
import React, { useState } from 'react';
import { Space, Switch, Typography } from 'antd';
import { CoopCard } from '../../../components/ui';
import { getNotificationPrefs, setNotificationPrefs } from '../../../notifications/prefs';

const ROWS = [
  {
    key: 'dailySummary' as const,
    title: 'Daily summary',
    blurb: 'Today at a glance — revenue, orders and notable changes.',
  },
  {
    key: 'lowStock' as const,
    title: 'Stock alerts',
    blurb: 'Low-stock and out-of-stock items in the notification center.',
  },
];

const NotificationsSection: React.FC = () => {
  const [prefs, setPrefs] = useState(getNotificationPrefs);

  return (
    <CoopCard title="Notifications" subtitle="What the in-app notification center shows.">
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        {ROWS.map((row) => (
          <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <Typography.Text strong>{row.title}</Typography.Text>
              <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12.5 }}>
                {row.blurb}
              </Typography.Text>
            </div>
            <Switch
              checked={prefs[row.key]}
              onChange={(checked) => setPrefs(setNotificationPrefs({ [row.key]: checked }))}
              aria-label={row.title}
            />
          </div>
        ))}
      </Space>
    </CoopCard>
  );
};

export default NotificationsSection;
