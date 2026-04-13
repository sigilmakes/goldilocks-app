import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { useAuthStore } from './store/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import Login from './pages/Login';
import Workspace from './pages/Workspace';

import ToastContainer from './components/ui/Toast';

const Settings = lazy(() => import('./pages/Settings'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Suspense fallback={<div className="flex items-center justify-center h-screen text-slate-400">Loading…</div>}>
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
