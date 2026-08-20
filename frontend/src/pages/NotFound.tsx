import React from 'react';
import { Button, Result, theme as antdTheme } from 'antd';
import { useNavigate } from 'react-router-dom';

/**
 * In-app 404 (Task 12 / M10). Unknown routes render this instead of an empty
 * app shell, and offer a one-click return to the Dashboard.
 */
const NotFound: React.FC = () => {
  const navigate = useNavigate();
  const { token } = antdTheme.useToken();

  return (
    <Result
      status="404"
      title="Page not found"
      subTitle="The page you're looking for doesn't exist or may have moved."
      style={{ color: token.colorText }}
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          Back to Dashboard
        </Button>
      }
    />
  );
};

export default NotFound;
