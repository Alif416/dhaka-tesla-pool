import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './useAuth.js';

/**
 * Redirects to /login when signed out, preserving the intended path. Renders nothing while the
 * initial `me` check is still loading.
 * @param {{ children: import('react').ReactNode }} props
 */
export function RequireAuth({ children }) {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return null;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}
