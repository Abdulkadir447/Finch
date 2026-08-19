import React from 'react';
import { SignIn } from '@clerk/react';

export const SignInPage: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Finch</h1>
          <p className="mt-2 text-sm text-gray-600">Your Business, Smarter.</p>
        </div>
        <SignIn
          afterSignInUrl="/"
          afterSignUpUrl="/"
          fallbackRedirectUrl="/"
        />
      </div>
    </div>
  );
};

export default SignInPage;