/**
 * Settings module (Task 9, UXDS Ch15) — two-column layout (UXDS 15.3),
 * restyled onto the Co-op design layer: PageHeader · CoopCard section
 * menu · CoopCard company form · shared loading/empty states.
 *
 * Scope this task: Company Settings only (UXDS 15.6), fully functional.
 * All other categories render honest "Coming soon" panels — no invented
 * controls. Appearance/theme persistence is deliberately deferred.
 *
 * Clerk identity is shown read-only (from Clerk, not editable here); the
 * business contact email is separate, editable business data.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Col,
  Divider,
  Form,
  Input,
  Menu,
  Row,
  Space,
  Typography,
  message,
} from 'antd';
import CoopSelect from '../../components/ui/CoopSelect';
import {
  BankOutlined,
  BellOutlined,
  CloudSyncOutlined,
  DatabaseOutlined,
  InfoCircleOutlined,
  KeyOutlined,
  RobotOutlined,
  SkinOutlined,
} from '@ant-design/icons';
import { useUser } from '@clerk/react';
import { CURRENCY_OPTIONS, TIMEZONE_OPTIONS, useSettings } from './useSettings';
import {
  CoopButton,
  CoopCard,
  CoopErrorState,
  CoopEmptyState,
  CoopLoading,
} from '../../components/ui';
import PageHeader from '../../components/layout/PageHeader';

const SECTIONS = [
  { key: 'company', label: 'Company', icon: <BankOutlined /> },
  { key: 'appearance', label: 'Appearance', icon: <SkinOutlined /> },
  { key: 'ai', label: 'AI', icon: <RobotOutlined /> },
  { key: 'notifications', label: 'Notifications', icon: <BellOutlined /> },
  { key: 'security', label: 'Security', icon: <KeyOutlined /> },
  { key: 'backup', label: 'Backup & Restore', icon: <DatabaseOutlined /> },
  { key: 'sync', label: 'Sync', icon: <CloudSyncOutlined /> },
  { key: 'about', label: 'About', icon: <InfoCircleOutlined /> },
];

const COMING_SOON: Record<string, { title: string; blurb: string }> = {
  appearance: { title: 'Appearance', blurb: 'Theme, light/dark and display preferences.' },
  ai: { title: 'AI Preferences', blurb: 'Response style, streaming and suggested prompts.' },
  notifications: { title: 'Notifications', blurb: 'Desktop, in-app, low-stock and report alerts.' },
  security: { title: 'Security', blurb: 'Password, two-factor authentication and active sessions.' },
  backup: { title: 'Backup & Restore', blurb: 'Back up your database locally or to the cloud.' },
  sync: { title: 'Synchronization', blurb: 'Cloud sync status and preferences.' },
  about: { title: 'About', blurb: 'Application version and license information.' },
};

interface CompanyFormValues {
  name: string;
  industry?: string;
  currency: string;
  owner_email?: string;
  address?: string;
  phone?: string;
  tax_id?: string;
  website?: string;
  timezone?: string;
}

const SettingsPage: React.FC = () => {
  const [messageApi, messageCtx] = message.useMessage();
  const [active, setActive] = useState('company');
  const [form] = Form.useForm<CompanyFormValues>();
  const { settings, loading, saving, error, save } = useSettings();
  const { user } = useUser();

  // Populate the form once settings arrive.
  useEffect(() => {
    if (!settings) return;
    form.setFieldsValue({
      name: settings.name,
      industry: settings.industry ?? undefined,
      currency: settings.currency,
      owner_email: settings.owner_email ?? undefined,
      address: settings.address ?? undefined,
      phone: settings.phone ?? undefined,
      tax_id: settings.tax_id ?? undefined,
      website: settings.website ?? undefined,
      timezone: settings.timezone ?? undefined,
    });
  }, [settings, form]);

  const handleSave = async () => {
    const values = await form.validateFields();
    // Only send fields that actually changed to keep the PATCH minimal.
    const updates: Record<string, unknown> = {};
    (Object.keys(values) as (keyof CompanyFormValues)[]).forEach((k) => {
      const v = values[k];
      const current = settings?.[k];
      if ((v ?? null) !== (current ?? null)) updates[k] = v ?? null;
    });
    if (Object.keys(updates).length === 0) {
      messageApi.info('No changes to save.');
      return;
    }
    try {
      await save(updates);
      messageApi.success('Company settings saved');
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const handleReset = () => {
    if (!settings) return;
    form.setFieldsValue({
      name: settings.name,
      industry: settings.industry ?? undefined,
      currency: settings.currency,
      owner_email: settings.owner_email ?? undefined,
      address: settings.address ?? undefined,
      phone: settings.phone ?? undefined,
      tax_id: settings.tax_id ?? undefined,
      website: settings.website ?? undefined,
      timezone: settings.timezone ?? undefined,
    });
    messageApi.info('Changes reset to last saved values.');
  };

  return (
    <div>
      {messageCtx}

      <PageHeader
        title="Settings"
        subtitle="Configure your business and application preferences."
      />

      {error && (
        <div style={{ marginBottom: 16 }}>
          <CoopErrorState
            title={error.isAuthError ? 'Authentication required' : 'Unable to load settings'}
            detail={error.message}
            onRetry={() => undefined}
          />
        </div>
      )}

      {/* Two-column layout (UXDS 15.3) */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6} lg={5}>
          <CoopCard flush bodyPadding={8}>
            <Menu
              mode="inline"
              selectedKeys={[active]}
              onClick={(e) => setActive(e.key)}
              items={SECTIONS.map((s) => ({ key: s.key, icon: s.icon, label: s.label }))}
              style={{ border: 'none' }}
            />
          </CoopCard>
        </Col>

        <Col xs={24} md={18} lg={19}>
          {active === 'company' ? (
            <CoopCard
              title="Company Settings"
              extra={
                <Space>
                  <CoopButton variant="secondary" onClick={handleReset} disabled={loading || saving}>
                    Reset
                  </CoopButton>
                  <CoopButton onClick={handleSave} loading={saving} disabled={loading}>
                    Save Changes
                  </CoopButton>
                </Space>
              }
            >
              {loading ? (
                <CoopLoading height={240} label="Loading company settings…" />
              ) : (
                <Form form={form} layout="vertical" requiredMark>
                  {/* Clerk identity — read-only, separate from business data */}
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                    message="Signed-in account"
                    description={
                      <Space direction="vertical" size={0}>
                        <Typography.Text>
                          {user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? 'Unknown'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {user?.primaryEmailAddress?.emailAddress ?? ''} · managed by Clerk, not
                          editable here
                        </Typography.Text>
                      </Space>
                    }
                  />

                  <Divider style={{ marginTop: 0 }}>Business Identity</Divider>
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Company Name"
                        name="name"
                        rules={[
                          { required: true, message: 'Company name is required' },
                          { max: 255, message: 'Name must be at most 255 characters' },
                        ]}
                      >
                        <Input placeholder="Your business name" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Industry"
                        name="industry"
                        rules={[{ max: 100, message: 'Industry must be at most 100 characters' }]}
                      >
                        <Input placeholder="e.g. Retail" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider>Contact & Details</Divider>
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Business Email"
                        name="owner_email"
                        rules={[
                          { type: 'email', message: 'Enter a valid email address' },
                          { max: 255, message: 'Email must be at most 255 characters' },
                        ]}
                      >
                        <Input placeholder="hello@yourbusiness.com" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Phone Number"
                        name="phone"
                        rules={[{ max: 20, message: 'Phone must be at most 20 characters' }]}
                      >
                        <Input placeholder="+234 ..." />
                      </Form.Item>
                    </Col>
                    <Col xs={24}>
                      <Form.Item
                        label="Business Address"
                        name="address"
                        rules={[{ max: 500, message: 'Address must be at most 500 characters' }]}
                      >
                        <Input.TextArea rows={2} placeholder="Street, city, state" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Divider>Billing & Locale</Divider>
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Currency" name="currency" rules={[{ required: true }]}>
                        <CoopSelect options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item label="Time Zone" name="timezone">
                        <CoopSelect
                          allowClear
                          showSearch
                          placeholder="Select time zone"
                          options={TIMEZONE_OPTIONS.map((t) => ({ value: t, label: t }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Tax Number"
                        name="tax_id"
                        rules={[{ max: 100, message: 'Tax number must be at most 100 characters' }]}
                      >
                        <Input placeholder="TIN / VAT number" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Form.Item
                        label="Website"
                        name="website"
                        rules={[{ max: 255, message: 'Website must be at most 255 characters' }]}
                      >
                        <Input placeholder="https://..." />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form>
              )}
            </CoopCard>
          ) : (
            <CoopCard title={COMING_SOON[active]?.title ?? 'Settings'}>
              <CoopEmptyState
                title={COMING_SOON[active]?.title ?? 'Settings'}
                description={`${COMING_SOON[active]?.blurb ?? ''} Coming soon — not yet implemented.`}
              />
            </CoopCard>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default SettingsPage;
