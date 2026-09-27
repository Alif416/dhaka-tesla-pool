import { useContext } from 'react';

import { AuthContext } from './AuthProvider.jsx';

/** @returns {{ user: object | null | undefined, status: string, login: Function,
 *   register: Function, logout: Function }} */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
