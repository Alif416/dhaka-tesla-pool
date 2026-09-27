import { createContext, useCallback, useEffect, useMemo, useState } from 'react';

import * as authApi from '../api/auth.js';
import { registerUnauthorizedHandler } from '../api/client.js';

export const AuthContext = createContext(null);

/**
 * The only global state in the app: the signed-in user. Registers the single `onUnauthorized`
 * handler the API client calls on a 401.
 * @param {{ children: import('react').ReactNode }} props
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = still loading, null = signed out
  const [status, setStatus] = useState('loading');

  const clearUser = useCallback(() => {
    setUser(null);
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(clearUser);
    authApi
      .me()
      .then((currentUser) => {
        setUser(currentUser);
        setStatus('signed-in');
      })
      .catch(() => {
        clearUser();
      });
  }, [clearUser]);

  const login = useCallback(async (input) => {
    const signedInUser = await authApi.login(input);
    setUser(signedInUser);
    setStatus('signed-in');
    return signedInUser;
  }, []);

  const register = useCallback(
    async (input) => {
      await authApi.register(input);
      return login({ email: input.email, password: input.password });
    },
    [login],
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    clearUser();
  }, [clearUser]);

  const value = useMemo(
    () => ({ user, status, login, register, logout }),
    [user, status, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
