
import { supabase } from '../lib/supabaseClient';
import { backendRequest } from './backendClient';
import { sessionIsLocked } from './sessionOrder';
import type { QuizPlan, QuizResult, AnswerFeedback, LearningReport, TeachingResult } from './backendClient';


// ---------------------------------------------------------------------------
// getNextLesson
// Returns the first session in Week 1 that has no completed session_progress
// row for the current user. Shapes result into the { topicId, topicName,
// chunks[] } format that LessonSession.tsx already consumes.
// ---------------------------------------------------------------------------
export const getNextLesson = async (specificSessionId?: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Resolve the canonical week for Grade 2 Mathematics.
  const { data: week } = await supabase
    .from('weeks')
    .select('id, chapter_id, chapters!inner(grade_level, subjects!inner(slug))')
    .eq('chapters.grade_level', await getCurrentGrade())
    .eq('chapters.subjects.slug', 'mathematics')
    .order('week_number', { ascending: true })
    .limit(1)
    .single();

  if (!week) return null;

  // Fetch all sessions and the student's completed progress IDs.
  // A session is 'next' if it has no completed session_progress row.
  const { data: completedProgress } = await supabase
    .from('session_progress')
    .select('session_id')
    .eq('student_id', user.id)
    .eq('status', 'completed');

  const completedIds = (completedProgress ?? []).map((p: any) => p.session_id);

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, title, topic_id, topic_name, order_index')
    .eq('week_id', week.id)
    .order('order_index', { ascending: true });

  if (!sessions || sessions.length === 0) return null;

  // Find targeted session
  let nextSession = null;
  if (specificSessionId) {
    nextSession = sessions.find((s: any) => s.id === specificSessionId);
    if (!nextSession) throw new Error('This session is not available in your current week.');
    const orderedSessions = sessions.map((session: any) => ({
      sessionId: session.id, orderIndex: session.order_index,
      status: completedIds.includes(session.id) ? 'completed' as const : 'not_started' as const,
    }));
    if (sessionIsLocked(orderedSessions.find(session => session.sessionId === specificSessionId)!, orderedSessions)) {
      throw new Error('Complete the earlier sessions in order before attending this lesson.');
    }
  }

  if (!nextSession) {
    // First session whose id is not in the completed set
    nextSession = sessions.find((s: any) => !completedIds.includes(s.id))
      ?? sessions[sessions.length - 1]; // all done → return last (dashboard handles this)
  }

  // Load its sections in order
  const { data: sections } = await supabase
    .from('session_sections')
    .select('id, chunk_id, explanation_style, content, section_type, order_index, question_prompt, correct_answer, question_format')
    .eq('session_id', nextSession.id)
    .order('order_index', { ascending: true });

  if (!sections || sections.length === 0) return null;

  const sectionsFormatted = sections.map((sec: any) => ({
    id: sec.id,
    chunkId: sec.chunk_id,
    sectionType: sec.section_type,
    explanationStyle: sec.explanation_style,
    content: sec.content,
    orderIndex: sec.order_index,
    questionPrompt: sec.question_prompt,
    correctAnswer: sec.correct_answer == null ? null : Number(sec.correct_answer),
    questionFormat: sec.question_format,
  }));

  return {
    sessionId: nextSession.id,
    topicId: nextSession.topic_id,
    topicName: nextSession.topic_name,
    chapterId: week.chapter_id,
    sections: sectionsFormatted,
    allDone: !specificSessionId && sessions.every((session: any) => completedIds.includes(session.id)),
  };
};

// ---------------------------------------------------------------------------
// recordPracticeResponse
// Inserts or updates a session_responses row for a lesson practice question.
// ---------------------------------------------------------------------------
export const recordPracticeResponse = async (
  _sessionId: string, sectionId: string, answer: number, attempts: number, timeTakenSeconds: number
) => backendRequest<AnswerFeedback>('/practice/answer', {
  section_id: sectionId, answer, attempts, time_taken_seconds: timeTakenSeconds,
});

// ---------------------------------------------------------------------------
// getWeeklyProgress
// Returns all 6 sessions for Week 1 with the student's real progress status.
// Used by the StudentDashboard weekly calendar.
// ---------------------------------------------------------------------------
export const getWeeklyProgress = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: week } = await supabase
    .from('weeks')
    .select('id, chapters!inner(grade_level, subjects!inner(slug))')
    .eq('chapters.grade_level', await getCurrentGrade())
    .eq('chapters.subjects.slug', 'mathematics')
    .order('week_number', { ascending: true })
    .limit(1)
    .single();

  if (!week) return [];

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, day_number, title, session_type, order_index')
    .eq('week_id', week.id)
    .order('order_index', { ascending: true });

  if (!sessions) return [];

  // Fetch all progress rows for this student at once
  const { data: progress } = await supabase
    .from('session_progress')
    .select('session_id, status')
    .eq('student_id', user.id)
    .in('session_id', sessions.map((s: any) => s.id));

  const progressMap: Record<string, string> = {};
  (progress ?? []).forEach((p: any) => {
    progressMap[p.session_id] = p.status;
  });

  return sessions.map((s: any) => ({
    sessionId: s.id,
    dayNumber: s.day_number,
    title: s.title,
    sessionType: s.session_type, // 'lesson' | 'revision'
    status: (progressMap[s.id] ?? 'not_started') as 'not_started' | 'in_progress' | 'completed',
    orderIndex: s.order_index,
  }));
};



// ---------------------------------------------------------------------------
// getWeeklyQuiz
// Fetches the first quiz (e.g. Week 1 quiz) from the database.
// ---------------------------------------------------------------------------
export const getWeeklyQuiz = async () => {
  const { data: week, error: weekError } = await supabase.from('weeks')
    .select('id, chapters!inner(grade_level, subjects!inner(slug))')
    .eq('chapters.grade_level', await getCurrentGrade())
    .eq('chapters.subjects.slug', 'mathematics').order('week_number').limit(1).single();
  if (weekError) throw new Error('Could not load your current assessment.');
  const { data, error } = await supabase
    .from('quizzes')
    .select('id, title, week_id')
    .eq('week_id', week.id)
    .limit(1)
    .single();
  if (error) throw new Error('Could not load your current assessment.');
  return data;
};

// Assessment rules live only in SQL, reached through the authenticated backend graph.
export const startQuizAttempt = async (quizId: string) =>
  backendRequest<QuizPlan>('/quiz/start', { quiz_id: quizId });
export const getQuizAttemptDetails = async (attemptId: string) =>
  backendRequest<QuizPlan>(`/quiz/${attemptId}`);
export const submitQuizAnswer = async (attemptId: string, questionId: string, selectedAnswer: number, timeTakenSeconds: number) =>
  backendRequest<AnswerFeedback>('/quiz/answer', { attempt_id: attemptId, question_id: questionId, answer: selectedAnswer, time_taken_seconds: timeTakenSeconds });
export const completeQuizAttempt = async (attemptId: string) =>
  backendRequest<QuizResult>('/quiz/finish', { attempt_id: attemptId });

// ---------------------------------------------------------------------------
// getLearnerProfile
// Reads the real profiles row for the authenticated user along with progress.
// ---------------------------------------------------------------------------
export const getLearnerProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, grade_level, preferred_explanation_style')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  // Fetch completed quiz history
  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('quiz_id, score, started_at, quizzes(title)')
    .eq('student_id', user.id)
    .eq('status', 'completed')
    .order('started_at', { ascending: true });

  const quizHistory = (attempts ?? []).map((att: any) => ({
    topicId: att.quiz_id,
    score: Math.round(Number(att.score)),
    date: new Date(att.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));

  // Fetch student's progress
  const { data: sp } = await supabase
    .from('student_progress')
    .select('topic_id, topic_name, mastery_status, primary_misconception_tag')
    .eq('student_id', user.id);

  const weakConcepts = (sp ?? [])
    .filter((c: any) => c.mastery_status === 'weak')
    .map((c: any) => ({
      topicId: c.topic_id,
      topicName: c.topic_name,
      primaryMisconceptionTag: c.primary_misconception_tag || 'Needs review',
    }));

  const masteredConcepts = (sp ?? [])
    .filter((c: any) => c.mastery_status === 'mastered')
    .map((c: any) => ({
      topicId: c.topic_id,
      topicName: c.topic_name,
    }));

  return {
    name: profile.name,
    gradeLevel: profile.grade_level,
    preferredExplanationStyle: profile.preferred_explanation_style,

    completedLessons: [] as string[],
    weakConcepts,
    masteredConcepts,
    quizHistory,
  };
};

export const getRecommendation = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { nextSession: null, weakTopics: [] };

  // Fetch student's weak topics from student_progress
  const { data: sp } = await supabase
    .from('student_progress')
    .select('topic_id, topic_name, primary_misconception_tag')
    .eq('student_id', user.id)
    .eq('mastery_status', 'weak');

  const weakTopics = [];
  if (sp && sp.length > 0) {
    for (const t of sp) {
      // Find a session ID for this topic (prefer revision/mixed practice sessions if possible)
      const { data: sessData } = await supabase
        .from('sessions')
        .select('id')
        .eq('topic_id', t.topic_id)
        .order('order_index', { ascending: false }) // Prefer revision/mixed practice
        .limit(1);

      weakTopics.push({
        topicId: t.topic_id,
        topicName: t.topic_name,
        primaryMisconceptionTag: t.primary_misconception_tag,
        sessionId: sessData && sessData.length > 0 ? sessData[0].id : null,
      });
    }
  }

  // Fetch completed session IDs to find the first incomplete session
  const { data: completedProgress } = await supabase
    .from('session_progress')
    .select('session_id')
    .eq('student_id', user.id)
    .eq('status', 'completed');

  const completedIds = (completedProgress ?? []).map((p: any) => p.session_id);

  // Resolve the canonical week for Grade 2 Mathematics
  const { data: week } = await supabase
    .from('weeks')
    .select('id, chapters!inner(grade_level, subjects!inner(slug))')
    .eq('chapters.grade_level', await getCurrentGrade())
    .eq('chapters.subjects.slug', 'mathematics')
    .order('week_number', { ascending: true })
    .limit(1)
    .single();

  let nextSession = null;
  if (week) {
    const { data: sessions } = await supabase
      .from('sessions')
      .select('id, title')
      .eq('week_id', week.id)
      .order('order_index', { ascending: true });

    if (sessions && sessions.length > 0) {
      nextSession = sessions.find((s: any) => !completedIds.includes(s.id)) || null;
    }
  }

  return {
    nextSession,
    weakTopics,
  };
};


// ---------------------------------------------------------------------------
// getEducatorSummary
// Reads the current user's own profile + quiz data.
// Known deliberate simplification: no separate educator account exists in
// current scope. recentScores/flaggedTopics are empty until Phase 5/6/7.
// ---------------------------------------------------------------------------
export const getEducatorSummary = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single();

  if (!profile) return null;

  // Retrieve recent completed quiz attempts
  const { data: attempts } = await supabase
    .from('quiz_attempts')
    .select('score, started_at, quizzes(title)')
    .eq('student_id', user.id)
    .eq('status', 'completed')
    .order('started_at', { ascending: false });

  const recentScores = (attempts ?? []).map((att: any) => ({
    topicName: att.quizzes?.title ?? 'Weekly Assessment',
    score: Math.round(Number(att.score)),
    date: new Date(att.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  }));

  // Retrieve flagged areas of study (weak topics)
  const { data: sp } = await supabase
    .from('student_progress')
    .select('topic_name, primary_misconception_tag')
    .eq('student_id', user.id)
    .eq('mastery_status', 'weak');

  const flaggedTopics = (sp ?? []).map((p: any) => ({
    topicName: p.topic_name,
    issue: p.primary_misconception_tag ? p.primary_misconception_tag.replace(/_/g, ' ') : 'Needs review',
  }));

  return {
    name: profile.name,

    recentScores,
    flaggedTopics,
  };
};


// Report generation is part of quiz completion; explicit regeneration uses the same graph.
export const generateReport = async (_studentId: string, attemptId: string) =>
  backendRequest<LearningReport>('/reports/generate', { attempt_id: attemptId });
export const getReports = async () => backendRequest<LearningReport[]>('/reports');

export const getDynamicExplanation = async (
  sectionId: string, _topicId: string, _chapterId: string,
  style: string, _grade: number, _originalContent: string, _force = false
) => {
  const result = await backendRequest<TeachingResult>('/teaching/ask', {
    section_id: sectionId, question: 'Explain this lesson differently and give me a simple example.', style,
  });
  return result.answer;
};

export const askMathAgent = async (
  sectionId: string, _topicId: string, _chapterId: string, query: string, _grade: number
) => {
  const result = await backendRequest<TeachingResult>('/teaching/ask', { section_id: sectionId, question: query });
  return result.answer;
};

async function getCurrentGrade() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Please sign in.');
  const { data, error } = await supabase.from('profiles').select('grade_level').eq('id', user.id).single();
  if (error || !data) throw new Error('Could not load your grade.');
  return data.grade_level;
}
