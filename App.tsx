
import React from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import EmployeeDashboard from './pages/EmployeeDashboard';
import AdminDashboard from './pages/AdminDashboard';
import ErrorBoundary from './components/ErrorBoundary';
import TotpSetupModal from './components/TotpSetupModal';
import { UserRole } from './types';

const AppContent: React.FC = () => {
  const { user, loading, needsTotpSetup, setNeedsTotpSetup } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="w-16 h-16 border-4 border-brand-green-dark border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  // Phase 9.2：SuperAdmin 強制守門 — 必須先啟用 2FA 才能進 dashboard
  if (user.role === UserRole.SuperAdmin && needsTotpSetup) {
    return (
      <TotpSetupModal
        forced
        onClose={() => setNeedsTotpSetup(false)}
        onCompleted={() => setNeedsTotpSetup(false)}
      />
    );
  }

  if (user.role === UserRole.SuperAdmin || user.role === UserRole.Admin) {
    return <AdminDashboard />;
  }

  return <EmployeeDashboard />;
};

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
