/**
 * Settings → Team (TRD Ch17 §17.7).
 *
 * The owner manages members and invitations (the five future roles);
 * managers see the roster read-only; other roles get a note. Backend
 * enforcement mirrors this exactly — the client only hides what the
 * backend already refuses.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Form, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { ColumnsType } from 'antd/es/table';
import { UserDeleteOutlined } from '@ant-design/icons';
import { CoopButton, CoopCard } from '../../../components/ui';
import { useCoopTheme } from '../../../theme-provider';
import { spacing, type } from '../../../theme';
import { useApiClient, ApiError } from '../../../services/api/client';
import { useTeamRole } from '../../../hooks/useTeamRole';

export const TEAM_ROLE_LABELS: Record<string, string> = {
  owner: 'Business Owner',
  manager: 'Manager',
  sales: 'Sales Staff',
  inventory: 'Inventory Staff',
  accountant: 'Accountant',
  viewer: 'Read-only Viewer',
};

const ROLE_OPTIONS = ['manager', 'sales', 'inventory', 'accountant', 'viewer'].map((r) => ({
  value: r,
  label: TEAM_ROLE_LABELS[r],
}));

interface TeamMemberRow {
  user_id: string;
  email: string | null;
  role: string;
}

interface TeamInviteRow {
  token: string;
  email: string;
  role: string;
  status: string;
}

const TeamSection: React.FC<{ messageApi: MessageInstance }> = ({ messageApi }) => {
  const api = useApiClient();
  const role = useTeamRole();
  const { colors } = useCoopTheme();
  const [members, setMembers] = useState<TeamMemberRow[]>([]);
  const [invites, setInvites] = useState<TeamInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('manager');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ members: TeamMemberRow[]; invitations: TeamInviteRow[] }>('/team');
      setMembers(r.data.members);
      setInvites(r.data.invitations);
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : 'Could not load the team');
    } finally {
      setLoading(false);
    }
  }, [api, messageApi]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      await api.post('/team/invites', { email: inviteEmail.trim(), role: inviteRole });
      messageApi.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail('');
      await load();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : 'Could not send the invitation');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (userId: string, nextRole: string) => {
    setBusy(true);
    try {
      await api.patch(`/team/members/${userId}`, { role: nextRole });
      messageApi.success('Role updated');
      await load();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : 'Could not update the role');
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(true);
    try {
      await api.delete(`/team/members/${userId}`);
      messageApi.success('Member removed');
      await load();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : 'Could not remove the member');
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (token: string) => {
    setBusy(true);
    try {
      await api.delete(`/team/invites/${token}`);
      messageApi.success('Invitation revoked');
      await load();
    } catch (e) {
      messageApi.error(e instanceof ApiError ? e.message : 'Could not revoke the invitation');
    } finally {
      setBusy(false);
    }
  };

  const memberColumns: ColumnsType<TeamMemberRow> = [
    { title: 'User', dataIndex: 'email', render: (_v, row) => row.email ?? row.user_id },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (_v, row) =>
        role === 'owner' ? (
          <Select
            size="small"
            value={row.role}
            options={ROLE_OPTIONS}
            onChange={(next) => void changeRole(row.user_id, next)}
            style={{ width: 170 }}
          />
        ) : (
          <Tag color={colors.primaryContainer} style={{ color: colors.onPrimaryContainer }}>
            {TEAM_ROLE_LABELS[row.role] ?? row.role}
          </Tag>
        ),
    },
  ];
  if (role === 'owner') {
    memberColumns.push({
      title: '',
      key: 'actions',
      render: (_v, row) => (
        <Popconfirm
          title="Remove this member?"
          description="They lose access immediately."
          onConfirm={() => void removeMember(row.user_id)}
        >
          <CoopButton variant="ghost" size="sm" disabled={busy} icon={<UserDeleteOutlined />}>
            Remove
          </CoopButton>
        </Popconfirm>
      ),
    });
  }

  const inviteColumns: ColumnsType<TeamInviteRow> = [
    { title: 'Email', dataIndex: 'email' },
    {
      title: 'Role',
      dataIndex: 'role',
      render: (r: string) => TEAM_ROLE_LABELS[r] ?? r,
    },
    { title: 'Status', dataIndex: 'status', render: (s: string) => <Tag>{s}</Tag> },
  ];
  if (role === 'owner') {
    inviteColumns.push({
      title: '',
      key: 'actions',
      render: (_v, row) =>
        row.status === 'pending' ? (
          <Popconfirm
            title="Revoke this invitation?"
            description="The link stops working immediately."
            onConfirm={() => void revokeInvite(row.token)}
          >
            <CoopButton variant="ghost" size="sm" disabled={busy}>
              Revoke
            </CoopButton>
          </Popconfirm>
        ) : null,
    });
  }

  return (
    <CoopCard title="Team">
      {role !== 'owner' && role !== 'manager' ? (
        <Typography.Paragraph type="secondary" style={{ ...type.bodyCompact }}>
          Your role ({TEAM_ROLE_LABELS[role ?? ''] ?? role}) is managed by the business owner.
        </Typography.Paragraph>
      ) : (
        <Space direction="vertical" size={spacing.lg} style={{ width: '100%' }}>
          {role === 'owner' && (
            <CoopCard title="Invite someone">
              <Alert
                type="info"
                showIcon
                message="The invitee signs in with the invited email, then accepts from the join screen."
                style={{ marginBottom: spacing.md }}
              />
              <Form layout="inline" onFinish={() => void sendInvite()}>
                <Form.Item
                  name="email"
                  rules={[{ type: 'email', required: true, message: 'Enter a valid email' }]}
                >
                  <Input
                    placeholder="teammate@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={{ width: 260 }}
                  />
                </Form.Item>
                <Form.Item name="role">
                  <Select
                    value={inviteRole}
                    options={ROLE_OPTIONS}
                    onChange={setInviteRole}
                    style={{ width: 170 }}
                  />
                </Form.Item>
                <CoopButton htmlType="submit" disabled={busy}>
                  Send invitation
                </CoopButton>
              </Form>
            </CoopCard>
          )}

          <CoopCard title={`Members (${members.length})`}>
            <Table
              size="small"
              rowKey="user_id"
              columns={memberColumns}
              dataSource={members}
              pagination={false}
              loading={loading}
              locale={{ emptyText: 'No team members yet — invite someone above.' }}
            />
          </CoopCard>

          <CoopCard title={`Invitations (${invites.length})`}>
            <Table
              size="small"
              rowKey="token"
              columns={inviteColumns}
              dataSource={invites}
              pagination={false}
              loading={loading}
              locale={{ emptyText: 'No invitations sent yet.' }}
            />
          </CoopCard>
        </Space>
      )}
    </CoopCard>
  );
};

export default TeamSection;
