import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';

interface LoginFormProps {
  onSubmit: (email: string, password: string, displayName?: string) => void;
  isLoading: boolean;
  error: string | null;
  isRegister: boolean;
}

export default function LoginForm({ onSubmit, isLoading, error, isRegister }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(email, password, isRegister ? displayName : undefined);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {isRegister && (
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-slate-300 mb-1">
            Display Name
          </label>
          <input
            id="displayName"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
            placeholder="Your name"
          />
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-1">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
          placeholder="••••••••"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-2 px-4 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-500/50 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            {isRegister ? 'Creating account...' : 'Signing in...'}
          </>
        ) : (
          isRegister ? 'Create Account' : 'Sign In'
        )}
      </button>
    </form>
  );
}
