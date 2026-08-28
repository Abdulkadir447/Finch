/**
 * Co-op — visible sync state (point #12: never hide synchronization).
 *
 * A compact TopBar pill that always tells the owner what's happening:
 *   ● Synced                 online, nothing pending
 *   ◌ Offline — saved locally  offline, desktop app (writes still work)
 *   ◌ Offline                offline, no local layer (browser — honest)
 *   ↻ Syncing…               a push is in flight
 *   ⚠ N to sync              online, ops awaiting push
 *
 * In a plain browser (no local data layer) offline is honest about the
 * limitation: there's no local store, so Co-op can't proceed until the
 * connection returns.
 */
import React from 'react';
import { useSyncStatus } from '../../sync/syncStatus';
import { useCoopTheme } from '../../theme-provider';
import { type } from '../../theme';

const SyncIndicator: React.FC = () => {
  const { colors } = useCoopTheme();
  const s = useSyncStatus();

  let dotColor: string = colors.success;
  let label = 'Synced';
  if (s.kind === 'offline-saved') {
    dotColor = colors.warning;
    label = 'Offline — saved on this device';
  } else if (s.kind === 'offline-no-local') {
    dotColor = colors.warning;
    label = 'Offline — reconnect to continue';
  } else if (s.kind === 'syncing') {
    dotColor = colors.primary;
    label = 'Syncing…';
  } else if (s.kind === 'needs-attention') {
    dotColor = colors.warning;
    label = `${s.pending} to sync`;
  }

  return (
    <span
      role="status"
      aria-label={`Sync status: ${label}`}
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '4px 10px',
        borderRadius: 9999,
        border: `1px solid ${colors.borderSubtle}`,
        background: colors.surfaceContainerLow,
        ...type.bodyCompact,
        fontSize: 12,
        color: colors.onSurfaceVariant,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          display: 'inline-block',
          animation: s.kind === 'syncing' ? 'coop-pulse 1s ease-in-out infinite' : undefined,
        }}
      />
      {label}
    </span>
  );
};

export default SyncIndicator;
