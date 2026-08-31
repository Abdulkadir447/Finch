/**
 * Settings → Sync. Live status of the offline-first sync engine (the same
 * store the TopBar pill reads): connection, pending uploads, parked
 * conflicts, mirror readiness and last sync time. The heavy lifting
 * (queue, conflicts, resolutions) lives in the Sync Center.
 */
import React from 'react';
import { Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useSyncStatus } from '../../../sync/syncStatus';
import { CoopButton, CoopCard } from '../../../components/ui';

function timeLabel(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const SyncSection: React.FC = () => {
  const status = useSyncStatus();
  const navigate = useNavigate();

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Connection', value: status.connection === 'online' ? 'Online' : 'Offline' },
    {
      label: 'Local database',
      value: status.localAvailable ? 'Active on this device' : 'Not available (browser mode)',
    },
    { label: 'Mirror', value: status.mirrorReady ? 'Ready' : 'Not pulled yet' },
    { label: 'Pending uploads', value: status.pending },
    { label: 'Conflicts needing attention', value: status.conflicts },
    { label: 'Last sync', value: timeLabel(status.lastSyncAt) },
  ];

  return (
    <CoopCard
      title="Synchronization"
      subtitle="Status of the offline-first sync engine (ADR-002)."
      extra={
        <CoopButton variant="secondary" onClick={() => navigate('/sync')}>
          Open Sync Center
        </CoopButton>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              {r.label}
            </Typography.Text>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {typeof r.value === 'number' && r.value > 0 ? (
                <Tag color={r.label.startsWith('Conflict') ? 'warning' : 'processing'}>{r.value}</Tag>
              ) : (
                r.value
              )}
            </span>
          </div>
        ))}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Work you do while offline is saved on this device and uploaded automatically when you
          reconnect. Conflicts are parked — you decide, nothing is auto-merged.
        </Typography.Text>
      </Space>
    </CoopCard>
  );
};

export default SyncSection;
