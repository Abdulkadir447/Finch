/**
 * Adjust Stock dialog (UXDS 11.11): Increase/Decrease + quantity + reason +
 * optional note, with a live current -> projected stock preview. The server
 * re-validates everything (409 when the result would go negative).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Typography,
  theme as antdTheme,
} from 'antd';
import { ADJUST_REASONS, AdjustInput, InventoryProduct } from './useInventory';

export interface StockAdjustModalProps {
  open: boolean;
  product: InventoryProduct | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (input: AdjustInput) => Promise<void>;
}

const StockAdjustModal: React.FC<StockAdjustModalProps> = ({
  open,
  product,
  submitting,
  onCancel,
  onSubmit,
}) => {
  const { token } = antdTheme.useToken();
  const [mode, setMode] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState<number>(1);
  const [reason, setReason] = useState<AdjustInput['reason']>('purchase');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('increase');
    setQuantity(1);
    setReason('purchase');
    setNote('');
    setProblem(null);
  }, [open, product?.id]);

  const change = mode === 'increase' ? quantity : -quantity;
  const projected = useMemo(
    () => (product ? product.current_stock + change : 0),
    [product, change],
  );
  const wouldGoNegative = projected < 0;

  const handleOk = async () => {
    if (!product) return;
    if (!quantity || quantity < 1) {
      setProblem('Enter a quantity of at least 1.');
      return;
    }
    if (wouldGoNegative) {
      setProblem(
        `Cannot remove ${quantity}: only ${product.current_stock} in stock.`,
      );
      return;
    }
    setProblem(null);
    await onSubmit({ change, reason, ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <Modal
      title={product ? `Adjust Stock — ${product.name}` : 'Adjust Stock'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText="Apply adjustment"
      cancelText="Discard"
      confirmLoading={submitting}
      okButtonProps={{ disabled: !product || wouldGoNegative }}
      destroyOnClose
      width={520}
    >
      {product && (
        <Space direction="vertical" size={16} style={{ width: '100%', marginTop: token.marginMD }}>
          {/* Current level */}
          <Typography.Text type="secondary">
            SKU <strong>{product.sku}</strong> · current stock:{' '}
            <strong style={{ color: token.colorText }}>{product.current_stock}</strong> · reorder at{' '}
            {product.reorder_level}
          </Typography.Text>

          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'increase', label: 'Increase Stock' },
              { value: 'decrease', label: 'Decrease Stock' },
            ]}
          />

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
              Quantity <Typography.Text type="danger">*</Typography.Text>
            </Typography.Text>
            <InputNumber
              min={1}
              precision={0}
              value={quantity}
              onChange={(v) => setQuantity(v ?? 1)}
              style={{ width: '100%' }}
            />
          </div>

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
              Reason <Typography.Text type="danger">*</Typography.Text>
            </Typography.Text>
            <Select
              value={reason}
              onChange={setReason}
              style={{ width: '100%' }}
              options={ADJUST_REASONS}
            />
          </div>

          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
              Note
            </Typography.Text>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="Optional — e.g. supplier delivery, damaged in storage"
            />
          </div>

          {/* Projected result */}
          <Alert
            type={wouldGoNegative ? 'error' : 'info'}
            showIcon
            message={
              wouldGoNegative
                ? 'This adjustment would make stock negative.'
                : `Stock will change from ${product.current_stock} to ${projected}.`
            }
          />

          {problem && <Alert type="warning" showIcon message={problem} />}
        </Space>
      )}
    </Modal>
  );
};

export default StockAdjustModal;
