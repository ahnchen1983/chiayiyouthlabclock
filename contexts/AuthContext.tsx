
import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { User, UserRole, LoginResult } from '../types';
import {
    apiLogin, apiLogout, apiInitializeDatabase,
    apiVerifyTotpLogin, apiGetTotpStatus,
} from '../services/googleAppsScriptAPI';
import { applyUserToSentry } from '../services/sentryUser';
import { disableFcm } from '../services/fcmClient';

interface AuthContextType {
  user: User | null;
  /**
   * Phase 9.2：login 改回傳 LoginResult。
   * - 'success'：登入完成，user 已設定
   * - 'requireTotp'：需 stage 2 TOTP 驗證，呼叫 completeTotpLogin
   * - 'fail'：帳密錯誤或鎖定
   */
  login: (username: string, password: string) => Promise<LoginResult>;
  /**
   * Phase 9.2 stage 2：用 totpToken + 6 位數碼或 recovery code 完成登入
   */
  completeTotpLogin: (totpToken: string, code: string, useRecovery: boolean) => Promise<{ user: User; recoveryCodesRemaining: number } | null>;
  logout: () => void;
  loading: boolean;
  /**
   * Phase 9.2：SuperAdmin 必須啟用 2FA 才能進 dashboard
   * - 登入成功後若為 SuperAdmin 且尚未啟用 2FA → true
   * - 啟用完成後由 setNeedsTotpSetup(false) 清除
   */
  needsTotpSetup: boolean;
  setNeedsTotpSetup: (v: boolean) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const finalizeLogin = async (
    loggedInUser: User,
    setUser: (u: User | null) => void,
    setNeedsTotpSetup: (v: boolean) => void,
): Promise<void> => {
    setUser(loggedInUser);
    sessionStorage.setItem('user', JSON.stringify(loggedInUser));
    applyUserToSentry({ id: loggedInUser.id, role: loggedInUser.role });
    // SuperAdmin 強制守門：登入成功後查詢 TOTP 狀態
    if (loggedInUser.role === UserRole.SuperAdmin) {
        try {
            const status = await apiGetTotpStatus();
            if (!status.enabled) setNeedsTotpSetup(true);
        } catch {
            // 若 status 查詢失敗，保守視為已啟用以免無限阻擋
        }
    }
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [needsTotpSetup, setNeedsTotpSetup] = useState<boolean>(false);

  useEffect(() => {
    apiInitializeDatabase().catch(console.error);
    const savedUser = sessionStorage.getItem('user');
    if (savedUser) {
      const parsed: User = JSON.parse(savedUser);
      setUser(parsed);
      applyUserToSentry({ id: parsed.id, role: parsed.role });
      // 還原 session 後同樣檢查 SuperAdmin 是否需 setup
      if (parsed.role === UserRole.SuperAdmin) {
          apiGetTotpStatus()
              .then(s => { if (!s.enabled) setNeedsTotpSetup(true); })
              .catch(() => {});
      }
    }
    setLoading(false);
  }, []);

  const login = async (username: string, password: string): Promise<LoginResult> => {
    setLoading(true);
    try {
      const result = await apiLogin(username, password);
      if (result.kind === 'success') {
          await finalizeLogin(result.user, setUser, setNeedsTotpSetup);
      }
      return result;
    } catch (error) {
      console.error("Login failed:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const completeTotpLogin = async (totpToken: string, code: string, useRecovery: boolean) => {
    setLoading(true);
    try {
        const res = await apiVerifyTotpLogin(totpToken, code, useRecovery);
        if (res) {
            await finalizeLogin(res.user, setUser, setNeedsTotpSetup);
        }
        return res;
    } finally {
        setLoading(false);
    }
  };

  const logout = () => {
    disableFcm().catch(() => {});
    setUser(null);
    setNeedsTotpSetup(false);
    sessionStorage.removeItem('user');
    applyUserToSentry(null);
    apiLogout().catch(console.error);
  };

  return (
    <AuthContext.Provider value={{ user, login, completeTotpLogin, logout, loading, needsTotpSetup, setNeedsTotpSetup }}>
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
