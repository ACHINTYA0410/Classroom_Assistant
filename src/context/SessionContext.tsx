/**
 * SessionContext.tsx
 * Manages the lifecycle of an active lesson session:
 *  - Tracks real active time (seconds), paused during breaks
 *  - Exposes break/resume actions wired to Supabase break_records
 *  - Exposes markDone() to complete the session
 *
 * Used by: LessonSession (startSession, markDone), TopNav (takeBreak/resume),
 *          useAttentionMonitor (activeSeconds)
 */
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  upsertSessionProgress,
  completeSession,
  flushActiveSeconds,
  insertBreakRecord,
  closeBreakRecord,
} from '../services/sessionService';

interface SessionContextType {
  /** UUID of the active session_progress row, null when no session is open */
  sessionProgressId: string | null;
  /** Elapsed active seconds, excluding break time */
  activeSeconds: number;
  /** True while the student is on a break */
  isOnBreak: boolean;
  /** Open a session: upsert progress row, start timer */
  startSession: (sessionId: string) => Promise<void>;
  /** Mark session complete: flush time, set status=completed */
  markDone: () => Promise<void>;
  /** Pause timer and insert a break_records row */
  takeBreak: () => Promise<void>;
  /** Close the break record, resume timer */
  resumeFromBreak: () => Promise<void>;
  /** Incremental flush (called on section transitions) */
  flushTime: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionProgressId, setSessionProgressId] = useState<string | null>(null);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [isOnBreak, setIsOnBreak] = useState(false);

  // Refs for values used inside setInterval without stale closure issues
  const progressIdRef = useRef<string | null>(null);
  const activeSecondsRef = useRef(0);
  const isOnBreakRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Break record tracking
  const breakIdRef = useRef<string | null>(null);
  const breakStartRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => { progressIdRef.current = sessionProgressId; }, [sessionProgressId]);
  useEffect(() => { activeSecondsRef.current = activeSeconds; }, [activeSeconds]);
  useEffect(() => { isOnBreakRef.current = isOnBreak; }, [isOnBreak]);

  const startTimer = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (!isOnBreakRef.current) {
        setActiveSeconds(prev => {
          const nextVal = prev + 1;
          activeSecondsRef.current = nextVal;
          // Auto-flush every 15 seconds to prevent loss if browser closes/crashes
          if (nextVal % 15 === 0 && progressIdRef.current) {
            flushActiveSeconds(progressIdRef.current, nextVal).catch(console.error);
          }
          return nextVal;
        });
      }
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startSession = useCallback(async (sessionId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const result = await upsertSessionProgress(sessionId, user.id);
    if (!result) return; // session already completed

    progressIdRef.current = result.id;
    setSessionProgressId(result.id);

    // Restore accumulated seconds if re-opening an in-progress session
    activeSecondsRef.current = result.totalActiveSeconds;
    setActiveSeconds(result.totalActiveSeconds);

    setIsOnBreak(false);
    isOnBreakRef.current = false;
    startTimer();
  }, [startTimer]);

  const flushTime = useCallback(async () => {
    if (!progressIdRef.current) return;
    await flushActiveSeconds(progressIdRef.current, activeSecondsRef.current);
  }, []);

  const markDone = useCallback(async () => {
    stopTimer();
    if (!progressIdRef.current) return;
    await completeSession(progressIdRef.current, activeSecondsRef.current);
    setSessionProgressId(null);
    progressIdRef.current = null;
    setActiveSeconds(0);
    activeSecondsRef.current = 0;
  }, [stopTimer]);

  const takeBreak = useCallback(async () => {
    if (!progressIdRef.current || isOnBreakRef.current) return;
    // Flush current time before pausing
    await flushActiveSeconds(progressIdRef.current, activeSecondsRef.current);

    const breakId = await insertBreakRecord(progressIdRef.current);
    if (!breakId) return;

    breakIdRef.current = breakId;
    breakStartRef.current = new Date().toISOString();
    setIsOnBreak(true);
    isOnBreakRef.current = true;
  }, []);

  const resumeFromBreak = useCallback(async () => {
    if (!progressIdRef.current || !breakIdRef.current || !breakStartRef.current) return;

    await closeBreakRecord(
      breakIdRef.current,
      progressIdRef.current,
      breakStartRef.current
    );

    breakIdRef.current = null;
    breakStartRef.current = null;
    setIsOnBreak(false);
    isOnBreakRef.current = false;
  }, []);

  // Flush on tab close / reload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (progressIdRef.current) {
        // Fire-and-forget synchronous-like call on unload
        flushActiveSeconds(progressIdRef.current, activeSecondsRef.current).catch(console.error);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopTimer(), [stopTimer]);

  return (
    <SessionContext.Provider value={{
      sessionProgressId,
      activeSeconds,
      isOnBreak,
      startSession,
      markDone,
      takeBreak,
      resumeFromBreak,
      flushTime,
    }}>
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = (): SessionContextType => {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
};
