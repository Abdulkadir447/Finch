import React from 'react';
import { Button, Card, Empty, Space, Table, Tag, Typography, theme as antdTheme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { semantic } from '../../theme';
import { formatCurrency } from '../../pages/Dashboard/kpiConfig';

/** Order status vocabulary shared with the backend (backend/models.py). */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderRow {
  id: number;
  orderNumber: string;
  customer: string;
  date: string;
  status: OrderStatus;
  total: number;
}

/**
 * Semantic status tag (UXDS 1.17 — color-independent status indicators),
 * matching the Finch design tokens in theme.ts.
 */
export const OrderStatusTag: React.FC<{ status: OrderStatus }> = ({ status }) => {
  const map: Record<OrderStatus, { color: string; bg: string }> = {
    pending: { color: semantic.warning, bg: semantic.warningBg },
    confirmed: { color: semantic.info, bg: semantic.infoBg },
    shipped: { color: semantic.info, bg: semantic.infoBg },
    delivered: { color: semantic.success, bg: semantic.successBg },
    cancelled: { color: semantic.error, bg: semantic.errorBg },
  };
  const { color, bg } = map[status];
  return (
    <Tag
      style={{
        color,
        background: bg,
        border: 'none',
        borderRadius: 6,
        textTransform: 'capitalize',
        fontWeight: 500,
      }}
    >
      {status}
    </Tag>
  );
};

/**
 * Recent Orders section (UXDS 9.15 Recent Activity / task spec item 4).
 *
 * Column structure is adapted from the project's "Table with products"
 * template (item cell + status badge + amount + action) onto the existing
 * antd Table primitive themed by the Finch ConfigProvider. The backend is
 * not connected yet, so the table renders its empty state.
 */
const RecentOrdersTable: React.FC<{ orders?: OrderRow[] }> = ({ orders = [] }) => {
  const { token } = antdTheme.useToken();

  const columns: ColumnsType<OrderRow> = [
    {
      title: 'Order',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: token.colorText }}>
            {value}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {row.date}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Customer',
      dataIndex: 'customer',
      key: 'customer',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: OrderStatus) => <OrderStatusTag status={status} />,
    },
    {
      title: 'Total',
      dataIndex: 'total',
      key: 'total',
      align: 'right',
      render: (value: number) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(value)}
        </Typography.Text>
      ),
    },
    {
      title: '',
      key: 'action',
      align: 'right',
      render: () => (
        <Button type="link" size="small" disabled>
          View
        </Button>
      ),
    },
  ];

  return (
    <Card
      title={
        <Typography.Text
          strong
          style={{ color: token.colorText, fontSize: token.fontSizeHeading4 }}
        >
          Recent Orders
        </Typography.Text>
      }
      extra={
        <Button type="link" disabled>
          View all
        </Button>
      }
      // Flush table: the data panel spans the full card, premium data-grid style.
      styles={{ body: { padding: 0 } }}
    >
      <Table<OrderRow>
        rowKey="id"
        size="middle"
        columns={columns}
        dataSource={orders}
        pagination={false}
        scroll={{ x: 560 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Space direction="vertical" size={2}>
                  <Typography.Text>No orders yet</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    New orders will appear here once your data is connected.
                  </Typography.Text>
                </Space>
              }
            />
          ),
        }}
      />
    </Card>
  );
};

export default RecentOrdersTable;
