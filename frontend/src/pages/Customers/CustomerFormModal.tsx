/**
 * Add/Edit Customer modal — antd Modal + Form adaptation of the Flowbite
 * CRUD modal templates (2-column grid, description/address spanning both
 * columns, Add/Update + Discard footer). Validation mirrors the backend
 * pydantic rules exactly.
 */
import React, { useEffect } from 'react';
import { Col, Form, Input, Modal, Row, theme as antdTheme } from 'antd';
import type { Customer, CustomerFormValues } from './useCustomers';

export interface CustomerFormModalProps {
  open: boolean;
  /** null = create mode; a Customer = edit mode. */
  customer: Customer | null;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (values: CustomerFormValues) => Promise<void>;
}

const CustomerFormModal: React.FC<CustomerFormModalProps> = ({
  open,
  customer,
  submitting,
  onCancel,
  onSubmit,
}) => {
  const { token } = antdTheme.useToken();
  const [form] = Form.useForm<CustomerFormValues>();
  const editing = Boolean(customer);

  useEffect(() => {
    if (!open) return;
    if (customer) {
      form.setFieldsValue({
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone ?? undefined,
        company: customer.company ?? undefined,
        address: customer.address ?? undefined,
      });
    } else {
      form.resetFields();
    }
  }, [open, customer, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    await onSubmit(values);
  };

  return (
    <Modal
      title={editing ? 'Update Customer' : 'Add Customer'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={editing ? 'Update customer' : 'Add customer'}
      cancelText="Discard"
      confirmLoading={submitting}
      destroyOnClose
      width={640}
    >
      <Form form={form} layout="vertical" requiredMark style={{ marginTop: token.marginMD }}>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Full Name"
              name="full_name"
              rules={[
                { required: true, message: 'Full name is required' },
                { max: 255, message: 'Name must be at most 255 characters' },
              ]}
            >
              <Input placeholder="Type customer name" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Email"
              name="email"
              rules={[
                { required: true, message: 'Email is required' },
                { type: 'email', message: 'Enter a valid email address' },
                { max: 255, message: 'Email must be at most 255 characters' },
              ]}
            >
              <Input placeholder="customer@example.com" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Phone"
              name="phone"
              rules={[{ max: 20, message: 'Phone must be at most 20 characters' }]}
            >
              <Input placeholder="Optional" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              label="Company"
              name="company"
              rules={[{ max: 255, message: 'Company must be at most 255 characters' }]}
            >
              <Input placeholder="Optional" />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item
              label="Address"
              name="address"
              rules={[{ max: 500, message: 'Address must be at most 500 characters' }]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount placeholder="Write customer address here" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default CustomerFormModal;
