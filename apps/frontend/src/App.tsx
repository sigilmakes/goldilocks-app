import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { useAuthStore } from './store/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './pages/Login';
import Workspace from './pages/Workspace';

import ToastContainer from './components/ui/Toast';

const Settings = lazy(() => import('./pages/Settings'));

function FullScreenLoading({ label = 'Loading…' }: { label?: string }) {
  return <div className="flex items-center justify-center h-screen text-slate-400">{label}</div>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasCheckedAuth = useAuthStore((s) => s.hasCheckedAuth);

  if (!hasCheckedAuth) {
    return <FullScreenLoading label="Checking session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const hasCheckedAuth = useAuthStore((s) => s.hasCheckedAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  return (
    <ErrorBoundary>
      <Routes>
        <Route
          path="/login"
          element={hasCheckedAuth && isAuthenticated ? <Navigate to="/" replace /> : <Login />}
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<FullScreenLoading />}>
                <Settings />
              </Suspense>
            </ProtectedRoute>
          }
        />

        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Workspace />
            </ProtectedRoute>
          }
        />
      </Routes>
      <ToastContainer />
    </ErrorBoundary>
  );
}
