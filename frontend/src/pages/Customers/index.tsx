/**
 * Customers module screen — same architecture as Products (Task 6),
 * adapted from the Flowbite CRUD table/modal/footer templates onto
 * Ant Design + Finch tokens. Delete uses the exact confirmation pattern
 * already implemented for Products. No sample/invented data.
 */
import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import CustomerFormModal from './CustomerFormModal';
import { Customer, CustomerFormValues, useCustomers } from './useCustomers';

const CustomersPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const [messageApi, messageCtx] = message.useMessage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    items,
    total,
    page,
    pageSize,
    search,
    setSearch,
    loading,
    error,
    reload,
    goToPage,
    createCustomer,
    updateCustomer,
    deleteCustomer,
  } = useCustomers();

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditing(customer);
    setModalOpen(true);
  };

  const handleSubmit = async (values: CustomerFormValues) => {
    setSubmitting(true);
    try {
      if (editing) {
        await updateCustomer(editing.id, values);
        messageApi.success('Customer updated');
      } else {
        await createCustomer(values);
        messageApi.success('Customer created');
      }
      setModalOpen(false);
      reload();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete confirmation — same pattern as Products (centered Modal.confirm,
  // danger "Yes, I'm sure" / "No, cancel"). Deletion is PERMANENT from the
  // user's perspective (Task 12 / M11); their order history is kept for
  // reporting (customers are soft-deleted and orders keep their reference).
  const confirmDelete = (customer: Customer) => {
    Modal.confirm({
      title: 'Delete customer',
      icon: <ExclamationCircleFilled />,
      content: `Are you sure you want to delete "${customer.full_name}" (${customer.email})? This is permanent and cannot be undone. Their order history is kept for reporting.`,
      centered: true,
      okText: "Yes, I'm sure",
      okButtonProps: { danger: true },
      cancelText: 'No, cancel',
      onOk: async () => {
        try {
          await deleteCustomer(customer.id);
          messageApi.success('Customer deleted');
          reload();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : 'Delete failed');
        }
      },
    });
  };

  const columns: ColumnsType<Customer> = [
    {
      title: 'Customer',
      dataIndex: 'full_name',
      key: 'full_name',
      render: (_: string, c) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: token.colorText }}>
            {c.full_name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {c.email}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Company',
      dataIndex: 'company',
      key: 'company',
      width: 180,
      render: (company: string | null) =>
        company ? (
          <Typography.Text style={{ color: token.colorText }}>{company}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      key: 'phone',
      width: 160,
      render: (phone: string | null) =>
        phone ? (
          <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>{phone}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_: unknown, c) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(c)}>
            Edit
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => confirmDelete(c)}
            aria-label={`Delete ${c.full_name}`}
          />
        </Space>
      ),
    },
  ];

  const showEmptyCta = !loading && !error && total === 0 && !search;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {messageCtx}

      {/* Page header */}
      <Space direction="vertical" size={2}>
        <Typography.Title level={2} style={{ margin: 0, color: token.colorText, fontWeight: 600 }}>
          Customers
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Manage your customer database and contact details.
        </Typography.Text>
      </Space>

      {/* Error banner (widgets stay visible underneath) */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.isAuthError ? 'Authentication required' : 'Unable to load customers'}
          description={error.message}
          action={
            <Button size="small" danger onClick={reload}>
              Retry
            </Button>
          }
        />
      )}

      {/* Table card: header row (count + CTA), search toolbar, table, footer */}
      <Card styles={{ body: { padding: 0 } }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 16,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Typography.Text>
            <span style={{ color: token.colorTextSecondary }}>All Customers: </span>
            <strong style={{ color: token.colorText }}>{loading ? '…' : total}</strong>
          </Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add customer
          </Button>
        </div>

        {/* Search toolbar */}
        <div style={{ padding: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Search for customers by name, email or company"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 420 }}
            aria-label="Search customers"
          />
        </div>

        <Table<Customer>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: 640 }}
          expandable={{
            expandedRowRender: (c) => (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  {c.address || 'No address provided.'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Created {dayjs(c.created_at).format('MMM D, YYYY HH:mm')}
                  {c.updated_at ? ` · Updated ${dayjs(c.updated_at).format('MMM D, YYYY HH:mm')}` : ''}
                </Typography.Text>
              </Space>
            ),
          }}
          locale={{
            emptyText: showEmptyCta ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text>No customers yet</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      Add your first customer to start building your customer base.
                    </Typography.Text>
                  </Space>
                }
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  Add customer
                </Button>
              </Empty>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Typography.Text>No customers match your search.</Typography.Text>}
              />
            ),
          }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (t, range) => `Showing ${range[0]}–${range[1]} of ${t}`,
            onChange: goToPage,
          }}
        />
      </Card>

      <CustomerFormModal
        open={modalOpen}
        customer={editing}
        submitting={submitting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default CustomersPage;
