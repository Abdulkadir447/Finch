/**
 * Orders module screen (Task 7) — same architecture as Products/Customers:
 * header (count + New order CTA), status filter + debounced search, table
 * with expandable line items, per-row status control limited to legal
 * transitions, delete with the shared confirmation pattern, pagination
 * footer, and honest loading/error/empty states. Templates = structural
 * reference only; all interaction is native antd.
 */
import React, { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  ExclamationCircleFilled,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { formatCurrency } from '../Dashboard/kpiConfig';
import OrderFormModal from './OrderFormModal';
import {
  Order,
  OrderCreateInput,
  OrderStatus,
  STATUS_META,
  useOrders,
} from './useOrders';

const orderNumber = (id: number) => `#ORD-${String(id).padStart(4, '0')}`;

const OrdersPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const [messageApi, messageCtx] = message.useMessage();
  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    items,
    total,
    page,
    pageSize,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    loading,
    error,
    reload,
    goToPage,
    createOrder,
    updateStatus,
    deleteOrder,
  } = useOrders();

  const handleCreate = async (input: OrderCreateInput) => {
    setSubmitting(true);
    try {
      await createOrder(input);
      messageApi.success('Order created');
      setCreateOpen(false);
      reload();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Order creation failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (order: Order, next: OrderStatus) => {
    try {
      await updateStatus(order.id, next);
      messageApi.success(
        next === 'cancelled' ? 'Order cancelled — stock restored' : `Order marked ${next}`,
      );
      reload();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Status update failed');
    }
  };

  // Delete confirmation — shared pattern (centered Modal.confirm, danger
  // "Yes, I'm sure" / "No, cancel"). Deletion is PERMANENT from the user's
  // perspective (Task 12 / M11).
  const confirmDelete = (order: Order) => {
    Modal.confirm({
      title: 'Delete order',
      icon: <ExclamationCircleFilled />,
      content: `Are you sure you want to delete ${orderNumber(order.id)}? This is permanent and cannot be undone.${
        order.status !== 'cancelled' ? ' Its stock will be restored.' : ''
      }`,
      centered: true,
      okText: "Yes, I'm sure",
      okButtonProps: { danger: true },
      cancelText: 'No, cancel',
      onOk: async () => {
        try {
          await deleteOrder(order.id);
          messageApi.success('Order deleted');
          reload();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : 'Delete failed');
        }
      },
    });
  };

  const columns: ColumnsType<Order> = [
    {
      title: 'Order',
      dataIndex: 'id',
      key: 'order',
      render: (_: number, o) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: token.colorText }}>
            {orderNumber(o.id)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {dayjs(o.order_date).format('MMM D, YYYY')}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Customer',
      key: 'customer',
      render: (_: unknown, o) =>
        o.customer ? (
          <Typography.Text style={{ color: token.colorText }}>{o.customer.full_name}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Items',
      key: 'items',
      width: 90,
      align: 'center',
      render: (_: unknown, o) => o.items.length,
    },
    {
      title: 'Total',
      dataIndex: 'total_amount',
      key: 'total',
      width: 130,
      align: 'right',
      render: (v: number) => (
        <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (status: OrderStatus) => {
        const meta = STATUS_META[status];
        return (
          <Tag style={{ color: meta.color, background: meta.bg, border: 'none', borderRadius: 6, fontWeight: 500 }}>
            {meta.label}
          </Tag>
        );
      },
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 220,
      align: 'right',
      render: (_: unknown, o) => {
        const nexts = o.allowed_transitions ?? [];
        return (
          <Space size={4}>
            <Select
              size="small"
              value={o.status}
              disabled={nexts.length === 0}
              onChange={(next) => handleStatusChange(o, next)}
              style={{ width: 130 }}
              aria-label={`Change status of ${orderNumber(o.id)}`}
              options={[
                { value: o.status, label: STATUS_META[o.status].label },
                ...nexts.map((n) => ({ value: n, label: `→ ${STATUS_META[n].label}` })),
              ]}
            />
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => confirmDelete(o)}
              aria-label={`Delete ${orderNumber(o.id)}`}
            />
          </Space>
        );
      },
    },
  ];

  const showEmptyCta = !loading && !error && total === 0 && !search && statusFilter === 'all';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {messageCtx}

      {/* Page header */}
      <Space direction="vertical" size={2}>
        <Typography.Title level={2} style={{ margin: 0, color: token.colorText, fontWeight: 600 }}>
          Orders
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Manage customer orders, fulfillment status and stock.
        </Typography.Text>
      </Space>

      {/* Error banner (widgets stay visible underneath) */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.isAuthError ? 'Authentication required' : 'Unable to load orders'}
          description={error.message}
          action={
            <Button size="small" danger onClick={reload}>
              Retry
            </Button>
          }
        />
      )}

      {/* Table card */}
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
            <span style={{ color: token.colorTextSecondary }}>All Orders: </span>
            <strong style={{ color: token.colorText }}>{loading ? '…' : total}</strong>
          </Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            New order
          </Button>
        </div>

        {/* Toolbar: status filter + search */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            padding: 16,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            style={{ width: 170 }}
            aria-label="Filter by status"
            options={[
              { value: 'all', label: 'All statuses' },
              ...(Object.keys(STATUS_META) as OrderStatus[]).map((s) => ({
                value: s,
                label: STATUS_META[s].label,
              })),
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Search by customer name or order number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
            aria-label="Search orders"
          />
        </div>

        <Table<Order>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: 760 }}
          expandable={{
            expandedRowRender: (o) => (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                {o.items.map((item) => (
                  <Typography.Text key={item.id} type="secondary">
                    {item.product_name ?? `Product #${item.product_id}`} — {item.quantity} ×{' '}
                    {formatCurrency(item.unit_price)} ={' '}
                    <strong>{formatCurrency(item.total_price)}</strong>
                  </Typography.Text>
                ))}
              </Space>
            ),
          }}
          locale={{
            emptyText: showEmptyCta ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text>No orders yet</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      Create your first order to start tracking sales.
                    </Typography.Text>
                  </Space>
                }
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                  New order
                </Button>
              </Empty>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Typography.Text>No orders match your filters.</Typography.Text>}
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

      <OrderFormModal
        open={createOpen}
        submitting={submitting}
        onCancel={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
};

export default OrdersPage;
