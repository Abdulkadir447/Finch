/**
 * Products module screen — structure adapted from the Finch Flowbite
 * reference templates (Table with products, CRUD layout, header with CTA,
 * delete confirmation modal, table footer pagination) onto Ant Design +
 * Finch theme tokens. All interactions are native antd (Modal.confirm for
 * delete, Table pagination for the footer). No sample/invented data.
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
  Tag,
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
import { brand, semantic } from '../../theme';
import { formatCurrency } from '../Dashboard/kpiConfig';
import ProductFormModal from './ProductFormModal';
import { Product, ProductFormValues, useProducts } from './useProducts';

type StockTone = 'ok' | 'warning' | 'low';

function stockTone(p: Product): StockTone {
  if (p.current_stock <= p.reorder_level) return 'low';
  if (p.current_stock <= p.reorder_level * 1.5) return 'warning';
  return 'ok';
}

const TONE_COLOR: Record<StockTone, string> = {
  ok: semantic.success,
  warning: semantic.warning,
  low: semantic.error,
};

const ProductsPage: React.FC = () => {
  const { token } = antdTheme.useToken();
  const [messageApi, messageCtx] = message.useMessage();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
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
    createProduct,
    updateProduct,
    deleteProduct,
  } = useProducts();

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setModalOpen(true);
  };

  const handleSubmit = async (values: ProductFormValues) => {
    setSubmitting(true);
    try {
      if (editing) {
        // SKU and stock are immutable on update (Task 12 / M6). current_stock
        // is deliberately excluded so an edit can never zero or change stock —
        // stock moves only via Inventory -> Adjust Stock. The backend ignores
        // both fields too, but not sending them keeps the contract explicit.
        const { sku: _sku, current_stock: _stock, ...rest } = values;
        await updateProduct(editing.id, rest);
        messageApi.success('Product updated');
      } else {
        await createProduct(values);
        messageApi.success('Product created');
      }
      setModalOpen(false);
      reload();
    } catch (e) {
      messageApi.error(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  // Delete confirmation — adaptation of the "Default delete confirmation
  // modal" template (centered, warning icon, Yes I'm sure / No cancel).
  // Deletion is PERMANENT from the user's perspective (Task 12 / M11): there
  // is no trash/restore UI. The backend soft-deletes for ledger integrity.
  const confirmDelete = (product: Product) => {
    Modal.confirm({
      title: 'Delete product',
      icon: <ExclamationCircleFilled />,
      content: `Are you sure you want to delete "${product.name}" (${product.sku})? This is permanent and cannot be undone.`,
      centered: true,
      okText: "Yes, I'm sure",
      okButtonProps: { danger: true },
      cancelText: 'No, cancel',
      onOk: async () => {
        try {
          await deleteProduct(product.id);
          messageApi.success('Product deleted');
          reload();
        } catch (e) {
          messageApi.error(e instanceof Error ? e.message : 'Delete failed');
        }
      },
    });
  };

  const columns: ColumnsType<Product> = [
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
      width: 140,
      render: (category: string | null) =>
        category ? (
          <Tag
            style={{
              color: brand.primaryActive,
              background: brand.primarySurface,
              border: 'none',
              borderRadius: 6,
              fontWeight: 500,
            }}
          >
            {category}
          </Tag>
        ) : (
          <Typography.Text type="secondary">—</Typography.Text>
        ),
    },
    {
      title: 'Unit Price',
      dataIndex: 'unit_price',
      key: 'unit_price',
      width: 130,
      align: 'right',
      render: (v: number) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatCurrency(v)}
        </Typography.Text>
      ),
    },
    {
      title: 'Stock',
      dataIndex: 'current_stock',
      key: 'current_stock',
      width: 130,
      render: (_: number, p) => {
        const tone = stockTone(p);
        return (
          <Space size={8}>
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: TONE_COLOR[tone],
              }}
            />
            <Typography.Text strong style={{ color: token.colorText, fontVariantNumeric: 'tabular-nums' }}>
              {p.current_stock}
            </Typography.Text>
            {tone === 'low' && (
              <Tag style={{ color: semantic.error, background: semantic.errorBg, border: 'none', borderRadius: 6 }}>
                Low
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      align: 'right',
      render: (_: unknown, p) => (
        <Space size={4}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(p)}>
            Edit
          </Button>
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => confirmDelete(p)} aria-label={`Delete ${p.name}`} />
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
          Products
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Manage your catalog, stock levels and pricing.
        </Typography.Text>
      </Space>

      {/* Error banner (UXDS-style: widgets stay visible underneath) */}
      {error && (
        <Alert
          type="error"
          showIcon
          message={error.isAuthError ? 'Authentication required' : 'Unable to load products'}
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
        {/* Header with CTA (adapted from header-withcta template) */}
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
            <span style={{ color: token.colorTextSecondary }}>All Products: </span>
            <strong style={{ color: token.colorText }}>{loading ? '…' : total}</strong>
          </Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add product
          </Button>
        </div>

        {/* Search toolbar (adapted from CRUD layout template) */}
        <div style={{ padding: 16, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
            placeholder="Search for products by name, SKU or category"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 420 }}
            aria-label="Search products"
          />
        </div>

        <Table<Product>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={items}
          loading={loading}
          scroll={{ x: 640 }}
          expandable={{
            expandedRowRender: (p) => (
              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                <Typography.Text type="secondary">
                  {p.description || 'No description provided.'}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  Cost price: {p.cost_price != null ? formatCurrency(p.cost_price) : '—'} · Reorder at{' '}
                  {p.reorder_level} · Created {dayjs(p.created_at).format('MMM D, YYYY HH:mm')}
                  {p.updated_at ? ` · Updated ${dayjs(p.updated_at).format('MMM D, YYYY HH:mm')}` : ''}
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
                    <Typography.Text>No products yet</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      Add your first product to start building your catalog.
                    </Typography.Text>
                  </Space>
                }
              >
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                  Add product
                </Button>
              </Empty>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<Typography.Text>No products match your search.</Typography.Text>}
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

      <ProductFormModal
        open={modalOpen}
        product={editing}
        submitting={submitting}
        onCancel={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />
    </div>
  );
};

export default ProductsPage;
