import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.kind === 'fail') {
        setError(result.message || '帳號或密碼錯誤，請重新輸入。');
      }
    } catch (err: any) {
      setError(err?.message || '登入時發生錯誤，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <div className="w-32 h-32 mx-auto rounded-full bg-brand-green-dark flex items-center justify-center text-white font-bold text-5xl">青</div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">
            嘉義市有事青年實驗室
          </h2>
          <p className="mt-2 text-sm text-gray-600">人資排班打卡系統</p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleLogin}>
          <div className="space-y-4 rounded-md shadow-sm">
            <div>
              <label htmlFor="username" className="sr-only">帳號</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
                placeholder="帳號"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">密碼</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="relative block w-full px-3 py-2 text-gray-900 placeholder-gray-500 border border-gray-300 rounded-md focus:outline-none focus:ring-brand-green-dark focus:border-brand-green-dark sm:text-sm"
                placeholder="密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {error && <p className="text-sm text-center text-status-error">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="relative flex justify-center w-full px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md bg-brand-green-dark hover:bg-brand-green-light focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:bg-gray-400"
          >
            {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
