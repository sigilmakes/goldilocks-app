import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import LoginForm from '../components/auth/LoginForm';

export default function Login() {
  const navigate = useNavigate();
  const { login, register, isLoading, error, clearError } = useAuthStore();
  const [isRegister, setIsRegister] = useState(false);

  const handleSubmit = async (email: string, password: string, displayName?: string) => {
    try {
      if (isRegister) {
        await register(email, password, displayName);
      } else {
        await login(email, password);
      }
      navigate('/');
    } catch {
      // Error is handled by the store
    }
  };

  const toggleMode = () => {
    clearError();
    setIsRegister(!isRegister);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
              <div className="w-8 h-8 bg-amber-400 rounded-full flex items-center justify-center">
                <div className="w-4 h-4 bg-amber-300 rounded-full" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-white">Goldilocks</h1>
          </div>
          <p className="text-slate-400">
            DFT input file generation with ML-predicted parameters
          </p>
        </div>

        <div className="bg-slate-800 rounded-lg p-6 shadow-xl border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-6">
            {isRegister ? 'Create Account' : 'Sign In'}
          </h2>

          <LoginForm
            onSubmit={handleSubmit}
            isLoading={isLoading}
            error={error}
            isRegister={isRegister}
          />

          <div className="mt-6 text-center">
            <button
              onClick={toggleMode}
              className="text-amber-500 hover:text-amber-400 text-sm"
            >
              {isRegister
                ? 'Already have an account? Sign in'
                : "Don't have an account? Register"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
