import React from 'react';
import { useNavigate } from 'react-router-dom';
import CoopButton from '../components/ui/CoopButton';
import { CoopEmptyState } from '../components/ui';

/**
 * In-app 404 (Task 12 / M10). Unknown routes render this instead of an empty
 * app shell, and offer a one-click return to the Dashboard.
 */
const NotFound: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div style={{ paddingTop: 48 }}>
      <CoopEmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or may have moved."
        action={
          <CoopButton onClick={() => navigate('/')}>Back to Dashboard</CoopButton>
        }
      />
    </div>
  );
};

export default NotFound;
