import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { SettingsProvider } from './context/SettingsContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SessionProvider } from './context/SessionContext';
import { Layout } from './components/Layout';
import { Onboarding } from './pages/Onboarding';
import { Login } from './pages/Login';
import { AuthCallback } from './pages/AuthCallback';
import { StudentDashboard } from './pages/StudentDashboard';
import { LessonSession } from './pages/LessonSession';
import { AttentionCheckIn } from './pages/AttentionCheckIn';
import { QuizFeedback } from './pages/QuizFeedback';
import { ProgressProfile } from './pages/ProgressProfile';
import { EducatorDashboard } from './pages/EducatorDashboard';
import { StreaksBadges } from './pages/StreaksBadges';
import { Settings } from './pages/Settings';
import { Reports } from './pages/Reports';
import { AgentAuditView } from './pages/AgentAuditView';

/**
 * ProtectedRoute — redirects to /login if unauthenticated.
 * After auth resolves, redirects to /onboarding if onboarding isn't complete,
 * unless we're already on /onboarding.
 */
const ProtectedRoute = () => {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="font-body-md text-on-surface-variant">Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};

/**
 * Root redirect — decides where to send the user from "/".
 * Waits for auth to resolve, then routes based on session + onboarding status.
 */
const RootRedirect = () => {
  const { session, profile, loading } = useAuth();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (profile && !profile.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return <Navigate to="/dashboard" replace />;
};

function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
        <SessionProvider>
        <Router>
          <Routes>
            {/* Root redirect */}
            <Route path="/" element={<RootRedirect />} />

            {/* Public routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Session-gated but not "completed profile" gated — accessible right after signup */}
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<Onboarding />} />
            </Route>

            {/* Protected routes with shared Layout */}
            <Route element={<ProtectedRoute />}>
              <Route element={<Layout />}>
                <Route path="/dashboard" element={<StudentDashboard />} />
                <Route path="/lessons" element={<LessonSession />} />
                <Route path="/attention" element={<AttentionCheckIn />} />
                <Route path="/quiz" element={<QuizFeedback />} />
                <Route path="/progress" element={<ProgressProfile />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/educator" element={<EducatorDashboard />} />
                <Route path="/educator/audit" element={<AgentAuditView />} />
                <Route path="/streaks" element={<StreaksBadges />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
          </Routes>
        </Router>
        </SessionProvider>
      </SettingsProvider>
    </AuthProvider>
  );
}

export default App;
