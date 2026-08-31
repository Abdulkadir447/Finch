/**
 * Team invitation join screen (TRD Ch17 §17.7).
 *
 * Rendered by RootGate when /auth/me reports a pending invitation: the
 * invitee has no business yet, so no business endpoint may be touched.
 * Accepting binds the invitation to the signed-in Clerk identity and
 * reloads the app with the new tenant.
 */
import React, { useState } from 'react';
import { message, Spin, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useClerk } from '@clerk/react';
import { CoopButton, CoopCard } from '../../components/ui';
import { useCoopTheme } from '../../theme-provider';
import { radius, spacing, type } from '../../theme';
import { clearIdentityCache } from '../../repositories/identity';
import { useApiClient } from '../../services/api/client';
import type { TeamInviteIdentity } from '../../repositories/identity';

const ROLE_LABELS: Record<string, string> = {
  owner: 'Business Owner',
  manager: 'Manager',
  sales: 'Sales Staff',
  inventory: 'Inventory Staff',
  accountant: 'Accountant',
  viewer: 'Read-only Viewer',
};

const InviteJoinCard: React.FC<{
  invite: TeamInviteIdentity;
  onDone: () => void;
}> = ({ invite, onDone }) => {
  const api = useApiClient();
  const { signOut } = useClerk();
  const { colors } = useCoopTheme();
  const [busy, setBusy] = useState(false);
  const [messageApi, messageCtx] = message.useMessage();

  const accept = async () => {
    setBusy(true);
    try {
      const resp = await api.post('/team/invites/accept', { token: invite.token });
      if (resp.status !== 200) throw new Error('Accept failed');
      clearIdentityCache();
      messageApi.success(`Welcome to ${invite.business_name}`);
      onDone();
    } catch (e) {
      messageApi.error(
        e instanceof Error && e.message ? e.message : 'Could not accept the invitation'
      );
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: spacing.lg,
        background: colors.surfaceContainerLowest,
      }}
    >
      {messageCtx}
      <CoopCard style={{ maxWidth: 460, width: '100%', textAlign: 'center', padding: spacing.xl }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.md,
            margin: '0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.primaryContainer,
            color: colors.onPrimaryContainer,
            fontSize: 24,
          }}
        >
          <TeamOutlined />
        </div>
        <Typography.Title level={4} style={{ marginTop: spacing.md }}>
          Join {invite.business_name}
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ ...type.bodyCompact }}>
          You were invited as <strong>{ROLE_LABELS[invite.role] ?? invite.role}</strong>. Accept
          to access this business with the permissions of that role.
        </Typography.Paragraph>
        <div style={{ display: 'flex', gap: spacing.md, justifyContent: 'center', marginTop: spacing.lg }}>
          <CoopButton variant="secondary" onClick={() => void signOut()} disabled={busy}>
            Sign out
          </CoopButton>
          <CoopButton variant="primary" onClick={accept} disabled={busy}>
            {busy ? <Spin size="small" /> : 'Accept invitation'}
          </CoopButton>
        </div>
      </CoopCard>
    </div>
  );
};

export default InviteJoinCard;
