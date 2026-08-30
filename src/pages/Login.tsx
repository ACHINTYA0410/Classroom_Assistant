import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Mail, Lock, User, AlertCircle, Loader2 } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, signInWithGoogle } from '../services/auth';
import { useAuth } from '../context/AuthContext';

type Mode = 'signin' | 'signup';

export const Login = () => {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);


  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { error: signUpError } = await signUpWithEmail(name, email, password);
        if (signUpError) throw signUpError;
        // Signup succeeded — go to onboarding to complete profile
        navigate('/onboarding', { replace: true });
      } else {
        const { data, error: signInError } = await signInWithEmail(email, password);
        if (signInError) throw signInError;
        if (data.user) {
          // Fetch the latest profile directly — don't rely on stale context state
          // since refreshProfile() is async and the context hasn't re-rendered yet.
          await refreshProfile();
          // After refreshProfile, AuthContext will re-render; AppRouter will pick
          // up onboarding_completed and redirect correctly. Just push to /dashboard —
          // ProtectedRoute will bounce back to /onboarding if not yet complete.
          navigate('/dashboard', { replace: true });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };


  const handleGoogleAuth = async () => {
    setError(null);
    setLoading(true);
    try {
      const { error: googleError } = await signInWithGoogle();
      if (googleError) throw googleError;
      // OAuth redirects the browser; no further navigation needed here
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      setError(message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {/* Logo & Header */}
        <div className="flex flex-col items-center mb-8 animate-fade-in-up">
          <div className="w-16 h-16 rounded-full bg-surface-container flex items-center justify-center text-primary mb-4 shadow-sm">
            <BookOpen size={32} />
          </div>
          <h1 className="font-display-sm text-display-sm text-on-surface font-bold text-center">
            Inclusive Assistant
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1 text-center">
            {mode === 'signin' ? 'Welcome back! Sign in to continue.' : 'Create your learning account.'}
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface-container-lowest rounded-2xl shadow-[0_4px_32px_rgba(67,97,130,0.1)] border border-outline-variant/30 p-8">

          {/* Google Button */}
          <button
            id="btn-google-auth"
            onClick={handleGoogleAuth}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl border-2 border-outline-variant bg-surface hover:bg-surface-container-high transition-colors font-label-lg text-on-surface mb-6 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {/* Google icon (inline SVG to avoid external dependency) */}
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-outline-variant/50" />
            <span className="font-body-sm text-on-surface-variant text-sm">or</span>
            <div className="flex-1 h-px bg-outline-variant/50" />
          </div>

          {/* Email/Password Form */}
          <form onSubmit={handleEmailAuth} className="flex flex-col gap-4">

            {mode === 'signup' && (
              <div className="relative">
                <label htmlFor="input-name" className="font-label-sm text-on-surface-variant block mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                  <input
                    id="input-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    placeholder="Your name"
                    className="w-full pl-9 pr-4 py-3 rounded-xl bg-surface border border-outline-variant focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-body-md text-on-surface placeholder:text-on-surface-variant/50 transition-all"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="input-email" className="font-label-sm text-on-surface-variant block mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  id="input-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-surface border border-outline-variant focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-body-md text-on-surface placeholder:text-on-surface-variant/50 transition-all"
                />
              </div>
            </div>

            <div>
              <label htmlFor="input-password" className="font-label-sm text-on-surface-variant block mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
                <input
                  id="input-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : '••••••••'}
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-surface border border-outline-variant focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 font-body-md text-on-surface placeholder:text-on-surface-variant/50 transition-all"
                />
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-error/10 border border-error/30 text-error">
                <AlertCircle size={16} className="shrink-0 mt-0.5" />
                <p className="font-body-sm text-sm">{error}</p>
              </div>
            )}

            <button
              id="btn-email-submit"
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 rounded-xl bg-primary text-on-primary font-label-lg hover:bg-primary/90 active:scale-[0.99] transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          {/* Toggle sign-in / sign-up */}
          <p className="text-center font-body-sm text-on-surface-variant mt-6">
            {mode === 'signin' ? "Don't have an account?" : 'Already have an account?'}{' '}
            <button
              id="btn-toggle-mode"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-primary font-label-sm hover:underline"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};
