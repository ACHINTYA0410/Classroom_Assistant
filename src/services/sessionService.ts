import { backendRequest } from './backendClient';

export interface BreakActivity { id: 'breathing'|'doodle'|'bubbles'|'stretch'|'riddles'; seconds: number }
export interface LearningBreak {
  id: string; session_progress_id: string; session_id: string; break_start: string;
  allowed_seconds: number; activities: BreakActivity[]; agent_decision_id: string;
}
export interface BreakStatus { server_now: string; break: LearningBreak|null; expired?: boolean; recent_end?: {id:string;ended_reason:string}|null; reasoning_summary?: string }
export interface PracticeState { attempts: number; wrongAttempts: number; answerRevealed: boolean; isCorrect: boolean; canReveal: boolean; answer?: number; explanation?: string }
const sessions = new Map<string,string>();

export const getBreakStatus = () => backendRequest<BreakStatus>('/breaks/status');
export const upsertSessionProgress = async (sessionId: string, _userId: string) => {
  const row = await backendRequest<{id:string;total_active_seconds:number;status:string}>('/learning/session',{session_id:sessionId});
  sessions.set(row.id,sessionId);
  return {id:row.id,totalActiveSeconds:row.total_active_seconds};
};
export const completeSession = (progressId:string, totalActiveSeconds:number) =>
  backendRequest('/learning/session',{session_id:sessions.get(progressId),total_active_seconds:totalActiveSeconds,complete:true});
export const flushActiveSeconds = (progressId:string, totalActiveSeconds:number, keepalive=false) =>
  backendRequest('/learning/session',{session_id:sessions.get(progressId),total_active_seconds:totalActiveSeconds},keepalive);
export const requestBreak = (progressId:string) => backendRequest<BreakStatus>('/breaks/request',{progress_id:progressId});
export const resumeBreak = (breakId:string, activities:BreakActivity[], timeout=false) =>
  backendRequest<BreakStatus>('/breaks/resume',{break_id:breakId,activities,timeout});
export const saveBreakActivities = (breakId:string,activities:BreakActivity[]) =>
  backendRequest('/breaks/activities',{break_id:breakId,activities},true);
export const getPracticeState = (sectionId:string) => backendRequest<PracticeState>(`/practice/state/${sectionId}`);
export const revealPractice = (sectionId:string) => backendRequest<PracticeState>('/practice/reveal',{section_id:sectionId});
export const getTestTools = () => backendRequest<{enabled:boolean}>('/test-tools');
export const calendarComplete = (sessionId:string) => backendRequest('/test-tools/complete',{session_id:sessionId});
