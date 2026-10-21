import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * Handles the OAuth redirect callback from Supabase (Google sign-in).
 * Supabase automatically exchanges the code in the URL hash/query.
 * This component just waits for auth to resolve and redirects accordingly.
 */
export const AuthCallback = () => {
  const navigate = useNavigate();
  const { session, profile, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (session) {
      if (profile && !profile.onboarding_completed) {
        navigate('/onboarding', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } else {
      navigate('/login', { replace: true });
    }
  }, [loading, session, profile, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="font-body-md text-on-surface-variant">Completing sign-in…</p>
      </div>
    </div>
  );
};
