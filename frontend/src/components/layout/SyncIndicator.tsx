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
import { Link } from 'react-router-dom';
import { useSyncStatus } from '../../sync/syncStatus';
import { requestManualSync } from '../../sync/engine';
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
    if (s.pending > 0 && s.conflicts > 0) label = `${s.pending} to sync · ${s.conflicts} need attention`;
    else if (s.pending > 0) label = `${s.pending} to sync`;
    else label = `${s.conflicts} need attention`;
  }

  // Manual trigger (OFFLINE 3): online desktop app with work to move, or a
  // mirror still being prepared — one tap drains the queue + refreshes.
  const canSyncNow =
    s.localAvailable && s.connection === 'online' && (s.pending > 0 || !s.mirrorReady) && !s.syncing;

  // In the desktop app the pill is the entry point to the Sync Center
  // (OFFLINE 5): pending, parked conflicts, last sync.
  const pill = (
    <span
      role="status"
      aria-label={`Sync status: ${label}`}
      title={s.localAvailable ? `${label} — open Sync Center` : label}
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
        cursor: s.localAvailable ? 'pointer' : 'default',
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
      {canSyncNow && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            requestManualSync();
          }}
          aria-label="Sync now"
          title="Push pending changes and refresh from the cloud now"
          style={{
            border: `1px solid ${colors.outlineVariant}`,
            background: 'transparent',
            color: colors.primary,
            fontWeight: 600,
            fontSize: 11,
            borderRadius: 9999,
            padding: '1px 8px',
            cursor: 'pointer',
            marginLeft: 2,
          }}
        >
          Sync now
        </button>
      )}
    </span>
  );

  if (s.localAvailable) {
    return (
      <Link to="/sync" style={{ textDecoration: 'none', lineHeight: 0 }} aria-label="Open Sync Center">
        {pill}
      </Link>
    );
  }
  return pill;
};

export default SyncIndicator;
