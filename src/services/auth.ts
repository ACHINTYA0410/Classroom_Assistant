import { supabase } from '../lib/supabaseClient';

/**
 * Sign up a new user with email and password.
 * Passes `name` as user metadata so the DB trigger can use it when creating the profile.
 */
export const signUpWithEmail = async (name: string, email: string, password: string) => {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name },
    },
  });
};

/**
 * Sign in an existing user with email and password.
 */
export const signInWithEmail = async (email: string, password: string) => {
  return supabase.auth.signInWithPassword({ email, password });
};

/**
 * Sign in with Google OAuth.
 * Google client ID/secret are configured in the Supabase dashboard — no env vars needed here.
 */
export const signInWithGoogle = async () => {
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
};

/**
 * Sign out the current user and clear the session.
 */
export const signOut = async () => {
  return supabase.auth.signOut();
};

/**
 * Get the current session (null if not logged in).
 */
export const getSession = async () => {
  const { data } = await supabase.auth.getSession();
  return data.session;
};

/**
 * Subscribe to auth state changes (login, logout, token refresh).
 * Returns an unsubscribe function to call on cleanup.
 */
export const onAuthStateChange = (
  callback: Parameters<typeof supabase.auth.onAuthStateChange>[0]
) => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback);
  return () => subscription.unsubscribe();
};
