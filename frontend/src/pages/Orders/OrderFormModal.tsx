/**
 * New Order modal (Task 7 create-order flow, Phase-1 spec): customer select,
 * dynamic product lines with quantity + snapshot unit price (pre-filled from
 * the product catalog, editable per policy), live line/grand totals.
 * The server re-validates stock, duplicates and totals on submit.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Divider,
  InputNumber,
  Modal,
  Select,
  Space,
  Typography,
  theme as antdTheme,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { ApiError, useApiClient } from '../../services/api/client';
import { formatCurrency } from '../Dashboard/kpiConfig';
import type { OrderCreateInput } from './useOrders';

interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  unit_price: number;
  current_stock: number;
}

interface CatalogCustomer {
  id: number;
  full_name: string;
  email: string;
}

interface LineDraft {
  key: number;
  product_id?: number;
  quantity: number;
  unit_price?: number;
}

export interface OrderFormModalProps {
  open: boolean;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: OrderCreateInput) => Promise<void>;
}

let lineKeySeq = 1;

const OrderFormModal: React.FC<OrderFormModalProps> = ({
  open,
  submitting,
  onCancel,
  onSubmit,
}) => {
  const { token } = antdTheme.useToken();
  const api = useApiClient();

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [customers, setCustomers] = useState<CatalogCustomer[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  const [customerId, setCustomerId] = useState<number | undefined>();
  const [lines, setLines] = useState<LineDraft[]>([{ key: lineKeySeq++, quantity: 1 }]);
  const [formError, setFormError] = useState<string | null>(null);

  // Load the catalogs when the modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingCatalog(true);
    setCatalogError(null);
    Promise.all([
      api.get('/products', { params: { limit: 100 } }),
      api.get('/customers', { params: { limit: 100 } }),
    ])
      .then(([p, cu]) => {
        if (cancelled) return;
        setProducts(p.data.items);
        setCustomers(cu.data.items);
      })
      .catch((e) => {
        if (cancelled) return;
        setCatalogError(e instanceof ApiError ? e.message : 'Unable to load catalog data.');
      })
      .finally(() => !cancelled && setLoadingCatalog(false));
    return () => {
      cancelled = true;
    };
  }, [open, api]);

  // Reset the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setCustomerId(undefined);
    setLines([{ key: lineKeySeq++, quantity: 1 }]);
    setFormError(null);
  }, [open]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const selectedIds = useMemo(
    () => new Set(lines.map((l) => l.product_id).filter(Boolean)),
    [lines],
  );

  const grandTotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        if (l.product_id == null || l.unit_price == null) return sum;
        return sum + Math.round(l.unit_price * l.quantity * 100) / 100;
      }, 0),
    [lines],
  );

  const patchLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const chooseProduct = (key: number, productId: number) => {
    const product = productById.get(productId);
    patchLine(key, {
      product_id: productId,
      unit_price: product?.unit_price, // snapshot pre-fill (Task 7 policy)
    });
  };

  const addLine = () => setLines((prev) => [...prev, { key: lineKeySeq++, quantity: 1 }]);

  const removeLine = (key: number) =>
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));

  const validate = (): string | null => {
    if (customerId == null) return 'Select a customer for this order.';
    if (lines.length === 0) return 'Add at least one product line.';
    for (const l of lines) {
      if (l.product_id == null) return 'Every line needs a product.';
      if (!l.quantity || l.quantity < 1) return 'Every line needs a quantity of at least 1.';
      if (l.unit_price == null || l.unit_price <= 0) return 'Every line needs a unit price above 0.';
      const product = productById.get(l.product_id);
      if (product && l.quantity > product.current_stock) {
        return `Only ${product.current_stock} in stock for "${product.name}".`;
      }
    }
    return null;
  };

  const handleOk = async () => {
    const problem = validate();
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    await onSubmit({
      customer_id: customerId as number,
      items: lines.map((l) => ({
        product_id: l.product_id as number,
        quantity: l.quantity,
        unit_price: l.unit_price as number,
      })),
    });
  };

  return (
    <Modal
      title="New Order"
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={submitting ? 'Creating…' : `Create order${grandTotal > 0 ? ` — ${formatCurrency(grandTotal)}` : ''}`}
      cancelText="Discard"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loadingCatalog || Boolean(catalogError) }}
      destroyOnClose
      width={720}
    >
      <Space direction="vertical" size={16} style={{ width: '100%', marginTop: token.marginMD }}>
        {catalogError && <Alert type="error" showIcon message={catalogError} />}

        {/* Customer */}
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            Customer <Typography.Text type="danger">*</Typography.Text>
          </Typography.Text>
          <Select
            showSearch
            allowClear
            placeholder="Select customer"
            loading={loadingCatalog}
            value={customerId}
            onChange={(v) => setCustomerId(v)}
            optionFilterProp="label"
            style={{ width: '100%' }}
            options={customers.map((c) => ({ value: c.id, label: `${c.full_name} (${c.email})` }))}
            notFoundContent={loadingCatalog ? 'Loading…' : 'No customers yet — add one in the Customers module.'}
          />
        </div>

        <Divider style={{ margin: '4px 0' }} />

        {/* Product lines */}
        <div>
          <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
            Products <Typography.Text type="danger">*</Typography.Text>
          </Typography.Text>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {lines.map((line) => {
              const product = line.product_id != null ? productById.get(line.product_id) : undefined;
              const lineTotal =
                line.unit_price != null ? Math.round(line.unit_price * line.quantity * 100) / 100 : null;
              return (
                <Space key={line.key} align="start" wrap style={{ width: '100%' }}>
                  <Select
                    showSearch
                    placeholder="Select product"
                    loading={loadingCatalog}
                    value={line.product_id}
                    onChange={(v) => chooseProduct(line.key, v)}
                    optionFilterProp="label"
                    style={{ width: 260 }}
                    options={products.map((p) => ({
                      value: p.id,
                      label: `${p.name} (${p.current_stock} in stock)`,
                      disabled: p.current_stock === 0 || (selectedIds.has(p.id) && p.id !== line.product_id),
                    }))}
                    notFoundContent={loadingCatalog ? 'Loading…' : 'No products yet — add one in the Products module.'}
                  />
                  <InputNumber
                    min={1}
                    max={product?.current_stock ?? undefined}
                    precision={0}
                    value={line.quantity}
                    onChange={(v) => patchLine(line.key, { quantity: v ?? 1 })}
                    addonAfter="×"
                    style={{ width: 110 }}
                    aria-label="Quantity"
                  />
                  <InputNumber
                    min={0.01}
                    step={0.01}
                    precision={2}
                    value={line.unit_price}
                    onChange={(v) => patchLine(line.key, { unit_price: v ?? undefined })}
                    style={{ width: 130 }}
                    aria-label="Unit price"
                  />
                  <Typography.Text
                    style={{ minWidth: 80, fontVariantNumeric: 'tabular-nums', lineHeight: '32px' }}
                  >
                    {lineTotal != null ? formatCurrency(lineTotal) : '—'}
                  </Typography.Text>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    aria-label="Remove line"
                  />
                </Space>
              );
            })}
            <Button type="dashed" icon={<PlusOutlined />} onClick={addLine} style={{ width: '100%' }}>
              Add product line
            </Button>
          </Space>
        </div>

        {formError && <Alert type="warning" showIcon message={formError} />}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Typography.Text strong style={{ fontSize: token.fontSizeLG }}>
            Total: <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(grandTotal)}</span>
          </Typography.Text>
        </div>
      </Space>
    </Modal>
  );
};

export default OrderFormModal;
