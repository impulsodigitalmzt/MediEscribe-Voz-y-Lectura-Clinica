/**
 * useAuth — Authentication state management hook.
 */

import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import type { User, LoginRequest, RegisterRequest } from '../types';
import api from '../services/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (creds: LoginRequest) => Promise<void>;
  register: (details: RegisterRequest) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!api.isAuthenticated()) {
      setIsLoading(false);
      return;
    }
    try {
      const profile = await api.getProfile();
      setUser(profile);
    } catch {
      api.clearTokens();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const login = useCallback(async (creds: LoginRequest) => {
    setError(null);
    setIsLoading(true);
    try {
      await api.login(creds);
      const profile = await api.getProfile();
      setUser(profile);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Login failed. Please check your credentials.';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const register = useCallback(async (details: RegisterRequest) => {
    setError(null);
    setIsLoading(true);
    try {
      await api.register(details);
      const profile = await api.getProfile();
      setUser(profile);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || 'Registration failed. Please try again.';
      setError(msg);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.logout();
    setUser(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    try {
      const profile = await api.getProfile();
      setUser(profile);
    } catch { /* ignore */ }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return (
    <AuthContext.Provider value={{
      user,
      isLoading,
      isAuthenticated: !!user,
      login,
      register,
      logout,
      refreshProfile,
      error,
      clearError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
