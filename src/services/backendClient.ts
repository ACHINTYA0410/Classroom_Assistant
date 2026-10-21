import { supabase } from '../lib/supabaseClient';

export class BackendError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.status = status; }
}

const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

export async function backendRequest<T>(path: string, body?: unknown, keepalive = false): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new BackendError('Please sign in to continue.', 401);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 50000);
  try {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, keepalive,
    });
    const data = await response.json();
    if (!response.ok) throw new BackendError(typeof data.detail === 'string' ? data.detail : 'This request could not be completed.', response.status);
    return data.result as T;
  } catch (error) {
    if (error instanceof BackendError) throw error;
    throw new BackendError(controller.signal.aborted ? 'This request took too long. Please retry.' : 'The learning service is unavailable. Please retry shortly.');
  } finally {
    window.clearTimeout(timeout);
  }
}

export interface QuizQuestion { id: string; template: string; a: number; b: number; options: number[] }
export interface QuizPlan {
  attempt_id: string; started_at: string; time_limit_seconds: number; remaining_seconds: number;
  status: string; questions: QuizQuestion[]; answered_question_ids: string[]; explanation: string;
  adaptive: Record<string, unknown>;
}
export interface AnswerFeedback { isCorrect: boolean; misconceptionTag: string | null; explanation: string; attempts?:number; wrongAttempts?:number; canReveal?:boolean; answerRevealed?:boolean }
export interface QuizResult {
  fullMarks: boolean; report_pending?: boolean;
  correctCount: number; totalQuestions: number; scorePercentage: number; accuracyPercentage: number;
  missedQuestions: { questionText: string; correctAnswer: number; selectedAnswer: number | null; misconceptionTag: string | null }[];
  report?: LearningReport;
}
export interface LearningReport { quiz_attempt_id: string; id: string; generated_at: string; narrative: string; stats_snapshot: Record<string, any> }
export interface TeachingResult { answer: string; sufficient_context: boolean; fallback: boolean; context_ids: string[] }
