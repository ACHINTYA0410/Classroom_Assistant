/**
 * sessionService.ts
 * Pure Supabase write functions for session progress + break tracking.
 * No React hooks — safe to call from anywhere.
 */
import { supabase } from '../lib/supabaseClient';

// ---------------------------------------------------------------------------
// Session Progress
// ---------------------------------------------------------------------------

/**
 * Upserts a session_progress row for the given student + session.
 * - If no row exists: creates one with status='in_progress', started_at=now()
 * - If a row exists (e.g. student re-opens an in_progress session): leaves it
 *   unchanged so accumulated time is not reset.
 * Returns the row id and existing total_active_seconds to restore the timer.
 */
export const upsertSessionProgress = async (
  sessionId: string,
  userId: string
): Promise<{ id: string; totalActiveSeconds: number } | null> => {
  // Check for an existing row first
  const { data: existing } = await supabase
    .from('session_progress')
    .select('id, total_active_seconds, status')
    .eq('session_id', sessionId)
    .eq('student_id', userId)
    .single();

  if (existing) {
    // Don't re-open a completed session
    if (existing.status === 'completed') return null;
    return { id: existing.id, totalActiveSeconds: existing.total_active_seconds ?? 0 };
  }

  // Create a new row
  const { data: created, error } = await supabase
    .from('session_progress')
    .insert({
      session_id: sessionId,
      student_id: userId,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      total_active_seconds: 0,
      break_count: 0,
    })
    .select('id, total_active_seconds')
    .single();

  if (error || !created) return null;
  return { id: created.id, totalActiveSeconds: 0 };
};

/**
 * Marks a session as completed and stores the final active time.
 */
export const completeSession = async (
  progressId: string,
  totalActiveSeconds: number
): Promise<void> => {
  await supabase
    .from('session_progress')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      total_active_seconds: totalActiveSeconds,
    })
    .eq('id', progressId);
};

/**
 * Incremental flush — updates total_active_seconds without completing the session.
 * Called on each section transition so data survives a browser refresh.
 */
export const flushActiveSeconds = async (
  progressId: string,
  totalActiveSeconds: number
): Promise<void> => {
  await supabase
    .from('session_progress')
    .update({ total_active_seconds: totalActiveSeconds })
    .eq('id', progressId);
};

// ---------------------------------------------------------------------------
// Break Records
// ---------------------------------------------------------------------------

/**
 * Inserts a break_records row and returns its id.
 */
export const insertBreakRecord = async (
  progressId: string
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('break_records')
    .insert({
      session_progress_id: progressId,
      break_start: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) return null;
  return data.id;
};

/**
 * Closes a break record: sets break_end, computes duration_seconds,
 * and increments session_progress.break_count by 1.
 */
export const closeBreakRecord = async (
  breakId: string,
  progressId: string,
  breakStartIso: string
): Promise<number> => {
  const breakEnd = new Date();
  const breakStart = new Date(breakStartIso);
  const durationSeconds = Math.round((breakEnd.getTime() - breakStart.getTime()) / 1000);

  await supabase
    .from('break_records')
    .update({
      break_end: breakEnd.toISOString(),
      duration_seconds: durationSeconds,
    })
    .eq('id', breakId);

  // Increment break_count on the progress row
  await supabase.rpc('increment_break_count', { progress_id: progressId });

  return durationSeconds;
};
