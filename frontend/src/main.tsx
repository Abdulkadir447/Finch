import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import { ClerkErrorBoundary } from './auth/ClerkErrorBoundary';
import './styles.css';
import App from './App';

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error(
    'Missing VITE_CLERK_PUBLISHABLE_KEY environment variable. ' +
    'Set it in your .env file to configure Clerk authentication.'
  );
}

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
  <React.StrictMode>
    {/* Stage 3: if Clerk cannot initialise, show the Co-op error state
        instead of a white screen. */}
    <ClerkErrorBoundary>
      <ClerkProvider publishableKey={clerkPublishableKey}>
        <App />
      </ClerkProvider>
    </ClerkErrorBoundary>
  </React.StrictMode>
);
