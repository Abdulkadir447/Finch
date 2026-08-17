import { useAuth, useClerk, useUser } from '@clerk/clerk-react';

export type ClerkAuthState = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  user: ReturnType<typeof useUser>['user'];
};

export const useClerkAuth = (): ClerkAuthState & {
  signOut: () => Promise<void>;
} => {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  const handleSignOut = async () => {
    await signOut();
  };

  return {
    isLoaded,
    isSignedIn,
    user,
    signOut: handleSignOut,
  };
};