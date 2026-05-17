
import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { User } from '../types';
import { apiLogin, apiLogout, apiInitializeDatabase } from '../services/googleAppsScriptAPI';
import { applyUserToSentry } from '../services/sentryUser';

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<User | null>;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 初始化 Firestore（首次執行時寫入預設資料）
    apiInitializeDatabase().catch(console.error);
    // Check for saved user session
    const savedUser = sessionStorage.getItem('user');
    if (savedUser) {
      const parsed: User = JSON.parse(savedUser);
      setUser(parsed);
      // Phase 7.5：session 還原時也設 Sentry user context
      applyUserToSentry({ id: parsed.id, role: parsed.role });
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<User | null> => {
    setLoading(true);
    try {
      const loggedInUser = await apiLogin(username, password);
      if (loggedInUser) {
        setUser(loggedInUser);
        sessionStorage.setItem('user', JSON.stringify(loggedInUser));
        // Phase 7.5：登入時設 Sentry user context（只送 id + role）
        applyUserToSentry({ id: loggedInUser.id, role: loggedInUser.role });
        return loggedInUser;
      }
      return null;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setUser(null);
    sessionStorage.removeItem('user');
    // Phase 7.5：登出清除 Sentry user context
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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
