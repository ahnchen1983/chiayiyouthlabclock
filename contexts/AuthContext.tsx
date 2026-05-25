import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { User, LoginResult } from '../types';
import { apiLogin, apiLogout, apiInitializeDatabase } from '../services/googleAppsScriptAPI';
import { applyUserToSentry } from '../services/sentryUser';
import { disableFcm } from '../services/fcmClient';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const finalizeLogin = (loggedInUser: User, setUser: (u: User | null) => void): void => {
  setUser(loggedInUser);
  sessionStorage.setItem('user', JSON.stringify(loggedInUser));
  applyUserToSentry({ id: loggedInUser.id, role: loggedInUser.role });
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    apiInitializeDatabase().catch(console.error);
    const savedUser = sessionStorage.getItem('user');
    if (savedUser) {
      const parsed: User = JSON.parse(savedUser);
      setUser(parsed);
      applyUserToSentry({ id: parsed.id, role: parsed.role });
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    setLoading(true);
    try {
      const result = await apiLogin(username, password);
      if (result.kind === 'success') finalizeLogin(result.user, setUser);
      return result;
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    disableFcm().catch(() => {});
    setUser(null);
    sessionStorage.removeItem('user');
    applyUserToSentry(null);
    apiLogout().catch(console.error);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
