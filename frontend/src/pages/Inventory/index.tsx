/**
 * Inventory module screen (Task 8, UXDS Ch11) — table-first design:
 * KPI row (11.5), search + stock-status filter toolbar (11.14/11.15),
 * product table with In/Low/Out status badges and Adjust Stock (11.6),
 * expandable rows with description + immutable movement history (11.7/11.12).
 * Structure adapted from the free Flowbite table/CRUD patterns onto antd +
 * Finch tokens. No invented data.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
  theme as antdTheme,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined, SearchOutlined, TagsOutlined, WarningOutlined, DollarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useApiClient } from '../../services/api/client';
import { formatCurrency } from '../Dashboard/kpiConfig';
import StockAdjustModal from './StockAdjustModal';
import {
  AdjustInput,
  InventoryProduct,
  MOVEMENT_LABELS,
  STOCK_STATUS_META,
  StockStatus,
  stockStatusOf,
  unitValueOf,
  useInventory,
} from './useInventory';

/** One stat card for the KPI row (UXDS 11.5). */
const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  sub?: string;
}> = ({ icon, label, value, accent, sub }) => {
  const { token } = antdTheme.useToken();
  return (
    <Card styles={{ body: { padding: 16 } }} style={{ height: '100%' }}>
      <Space align="start" size={12}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: token.borderRadiusSM,
            background: `${accent}1A`,
            color: accent,
            fontSize: 16,
          }}
        >
          {icon}
        </span>
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {label}
          </Typography.Text>
          <Typography.Text
            strong
            style={{ fontSize: token.fontSizeHeading3, fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </Typography.Text>
          {sub && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {sub}
            </Typography.Text>
          )}
        </Space>
      </Space>
    </Card>
  );
};

/** Movement history — loaded lazily when a row is expanded (UXDS 11.12). */
const MovementHistory: React.FC<{ productId: number }> = ({ productId }) => {
  const api = useApiClient();
  const { token } = antdTheme.useToken();
  const [movements, setMovements] = useState<import('./useInventory').StockMovement[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/products/${productId}/movements`, { params: { limit: 20 } })
      .then((r) => !cancelled && setMovements(r.data.items))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [productId, api]);

  if (failed) return <Alert type="error" message="Unable to load stock history." />;
  if (!movements) return <Spin size="small" />;
  if (movements.length === 0) {
    return <Typography.Text type="secondary">No stock movements recorded yet.</Typography.Text>;
  }
  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {movements.map((m) => (
        <Space key={m.id} size={8} wrap>
          <Typography.Text
            strong
            style={{
              color: m.change >= 0 ? token.colorSuccess : token.colorError,
              fontVariantNumeric: 'tabular-nums',
              minWidth: 44,
            }}
          >
            {m.change > 0 ? `+${m.change}` : m.change}
          </Typography.Text>
          <Tag
            style={{
              color: token.colorTextSecondary,
              background: token.colorBgLayout,
              border: 'none',
              borderRadius: 6,
            }}
          >
            {MOVEMENT_LABELS[m.reason] ?? m.reason}
          </Tag>
          {m.order_id != null && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              Order #ORD-{String(m.order_id).padStart(4, '0')}
            </Typography.Text>
          )}
          {m.note && (
            <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              “{m.note}”
            </Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {dayjs(m.created_at).format('MMM D, HH:mm')}
          </Typography.Text>
        </Space>
      ))}
    </Space>
  );
};

const InventoryPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const [messageApi, messageCtx] = message.useMessage();
  const [adjusting, setAdjusting] = useState<InventoryProduct | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const {
    summary,
    items,
    total,
    page,
    pageSize,
    search,
    setSearch,
    stockFilter,
    setStockFilter,
    loading,
    error,
    reload,
    goToPage,
    adjustStock,
  } = useInventory();

  const handleAdjust = async (input: AdjustInput) => {
    if (!adjusting) return;
    setSubmitting(true);
    try {
      await adjustStock(adjusting.id, input);
      messageApi.success('Stock adjusted');
      setAdjusting(null);
      reload();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Adjustment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnsType<InventoryProduct> = [
    {
      title: 'Product',
      dataIndex: 'name',
      key: 'name',
      render: (_: string, p) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong style={{ color: token.colorText }}>
            {p.name}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {p.sku}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Category',
      dataIndex: 'category',
      key: 'category',
      width: 130,
      render: (category: string | null) =>
        category ? (
          <Typography.Text style={{ color: token.colorText }}>{category}</Typography.Text>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Stock',
      key: 'stock',
      width: 170,
      render: (_: unknown, p) => {
        const status = stockStatusOf(p);
        const meta = STOCK_STATUS_META[status];
        return (
          <Space size={8}>
            <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
              {p.current_stock}
            </Typography.Text>
            <Tag style={{ color: meta.color, background: meta.bg, border: 'none', borderRadius: 6, fontWeight: 500 }}>
              {meta.label}
            </Tag>
          </Space>
        );
      },
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 110,
      align: 'right',
      render: (v: number) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(v)}</Typography.Text>
      ),
    },
    {
      title: 'Cost Price',
      dataIndex: 'cost_price',
      key: 'cost_price',
      width: 110,
      align: 'right',
      render: (v: number | null) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {v != null ? formatCurrency(v) : '—'}
        </Typography.Text>
      ),
    },
    {
      title: 'Inventory Value',
      key: 'value',
      width: 140,
      align: 'right',
      render: (_: unknown, p) => (
        <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(Math.round(p.current_stock * unitValueOf(p) * 100) / 100)}
        </Typography.Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_: unknown, p) => (
        <Button size="small" onClick={() => setAdjusting(p)}>
          Adjust Stock
        </Button>
      ),
    },
  ];

  const showEmptyCta = !loading && !error && total === 0 && !search && stockFilter === 'all';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {messageCtx}

      {/* Page header (UXDS 11.4) */}
      <Space direction="vertical" size={2}>
        <Typography.Title level={2} style={{ margin: 0, color: token.colorText, fontWeight: 600 }}>
          Inventory
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Stock levels, valuation and movement history.
        </Typography.Text>
      </Space>

      {/* KPI row (UXDS 11.5) */}
      {summary && (
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={12} xl={6}>
            <StatCard
              icon={<InboxOutlined />}
              label="Products"
              value={String(summary.products_count)}
              accent={token.colorPrimary}
            />
          </Col>
          <Col xs={12} sm={12} xl={6}>
            <StatCard
              icon={<DollarOutlined />}
              label="Inventory Value"
              value={formatCurrency(summary.inventory_value)}
              accent={token.colorPrimary}
              sub="at cost price"
            />
          </Col>
          <Col xs={12} sm={12} xl={6}>
            <StatCard
              icon={<WarningOutlined />}
              label="Low Stock"
              value={String(summary.low_stock_count)}
              accent="#E0A106"
              sub={`${summary.out_of_stock_count} out of stock`}
            />
          </Col>
          <Col xs={12} sm={12} xl={6}>
            <StatCard
              icon={<TagsOutlined />}
              label="Categories"
              value={String(summary.categories_count)}
              accent={token.colorPrimary}
            />
          </Col>
        </Row>
      )}

      {/* Error banner (widgets stay visible underneath) */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.isAuthError ? 'Authentication required' : 'Unable to load inventory'}
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
        {/* Toolbar: stock filter + search (UXDS 11.14/11.15) */}
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
            value={stockFilter}
            onChange={(v) => setStockFilter(v)}
            style={{ width: 180 }}
            aria-label="Filter by stock status"
            options={[
              { value: 'all', label: 'All stock levels' },
              { value: 'in', label: 'In Stock' },
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' },
            ]}
          />
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Search by name, SKU or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 360 }}
            aria-label="Search inventory"
          />
        </div>

        <Table<InventoryProduct>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: 900 }}
          expandable={{
            expandedRowRender: (p) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  {p.description || 'No description provided.'}
                </Typography.Text>
                <Typography.Text strong style={{ fontSize: token.fontSizeSM }}>
                  Stock history
                </Typography.Text>
                <MovementHistory productId={p.id} />
              </Space>
            ),
          }}
          locale={{
            emptyText: showEmptyCta ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space direction="vertical" size={2}>
                    <Typography.Text>No products yet</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      Add products in the Products module to start tracking inventory.
                    </Typography.Text>
                  </Space>
                }
              />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Typography.Text>No products match your filters.</Typography.Text>}
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

      <StockAdjustModal
        open={adjusting !== null}
        product={adjusting}
        submitting={submitting}
        onCancel={() => setAdjusting(null)}
        onSubmit={handleAdjust}
      />
    </div>
  );
};

export default InventoryPage;
