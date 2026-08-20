/**
 * Add/Edit Product modal — antd Modal + Form adaptation of the Flowbite
 * "Create Modals / Update Modals (CRUD)" templates: header with title +
 * close, 2-column field grid, description spanning both columns, and
 * Add/Update + Discard footer actions. All interaction is native antd.
 *
 * SKU is the identity key: editable on create, locked on update (protects
 * order history). Validation mirrors the backend pydantic rules.
 */
import React, { useEffect } from 'react';
import { Col, Form, Input, InputNumber, Modal, Row, Typography, theme as antdTheme } from 'antd';
import type { Product, ProductFormValues } from './useProducts';

export interface ProductFormModalProps {
  open: boolean;
  /** null = create mode; a Product = edit mode. */
  product: Product | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: ProductFormValues) => Promise<void>;
}

const ProductFormModal: React.FC<ProductFormModalProps> = ({
  open,
  product,
  submitting,
  onCancel,
  onSubmit,
}) => {
  const { token } = antdTheme.useToken();
  const [form] = Form.useForm<ProductFormValues>();
  const editing = Boolean(product);

  useEffect(() => {
    if (!open) return;
    if (product) {
      form.setFieldsValue({
        sku: product.sku,
        name: product.name,
        description: product.description ?? undefined,
        category: product.category ?? undefined,
        unit_price: product.unit_price,
        cost_price: product.cost_price ?? undefined,
        reorder_level: product.reorder_level,
        // NOTE: current_stock is intentionally NOT editable after creation.
        // Stock changes only via Inventory -> Adjust Stock (audit trail).
      });
    } else {
      form.resetFields();
    }
  }, [open, product, form]);

  const costPrice = Form.useWatch('cost_price', form);
  const unitPrice = Form.useWatch('unit_price', form);
  const costExceedsPrice =
    typeof costPrice === 'number' && typeof unitPrice === 'number' && costPrice > unitPrice;

  const handleOk = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
  };

  return (
    <Modal
      title={editing ? 'Update Product' : 'Add Product'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={editing ? 'Update product' : 'Add product'}
      cancelText="Discard"
      confirmLoading={submitting}
      destroyOnClose
      width={640}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark
        initialValues={{ current_stock: 0, reorder_level: 5 }}
        style={{ marginTop: token.marginMD }}
      >
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="SKU"
              name="sku"
              rules={[
                { required: true, message: 'SKU is required' },
                { min: 3, max: 50, message: 'SKU must be 3–50 characters' },
              ]}
            >
              <Input placeholder="e.g. FIN-0001" disabled={editing} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Product Name"
              name="name"
              rules={[
                { required: true, message: 'Product name is required' },
                { max: 255, message: 'Name must be at most 255 characters' },
              ]}
            >
              <Input placeholder="Type product name" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Category"
              name="category"
              rules={[{ max: 100, message: 'Category must be at most 100 characters' }]}
            >
              <Input placeholder="e.g. Beverages" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Unit Price"
              name="unit_price"
              rules={[{ required: true, message: 'Unit price is required' }]}
            >
              <InputNumber min={0.01} step={0.01} precision={2} style={{ width: '100%' }} placeholder="0.00" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Cost Price"
              name="cost_price"
              extra={
                costExceedsPrice ? (
                  <Typography.Text type="warning" style={{ fontSize: token.fontSizeSM }}>
                    Cost price is higher than the unit price — this product would sell at a loss.
                  </Typography.Text>
                ) : undefined
              }
            >
              <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="Optional" />
            </Form.Item>
          </Col>
          {!editing && (
            <Col xs={12} sm={6}>
              <Form.Item
                label="Initial Stock"
                name="current_stock"
                rules={[{ required: true }]}
                extra="After creation, adjust stock via Inventory."
              >
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          )}
          <Col xs={12} sm={6}>
            <Form.Item label="Reorder Level" name="reorder_level" rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              label="Description"
              name="description"
              rules={[{ max: 1000, message: 'Description must be at most 1000 characters' }]}
            >
              <Input.TextArea rows={3} maxLength={1000} showCount placeholder="Write product description here" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default ProductFormModal;
