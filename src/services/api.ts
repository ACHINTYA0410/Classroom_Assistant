import attentionEventsData from '../mockData/attentionEvents.json';
import checkInQuestions from '../mockData/checkInQuestions.json';
import { supabase } from '../lib/supabaseClient';
import { generateNarrative } from './reportAgent';


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
    .eq('chapters.grade_level', 2)
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
    correctAnswer: sec.correct_answer ? Number(sec.correct_answer) : null,
    questionFormat: sec.question_format,
  }));

  return {
    sessionId: nextSession.id,
    topicId: nextSession.topic_id,
    topicName: nextSession.topic_name,
    chapterId: week.chapter_id,
    sections: sectionsFormatted,
    allDone: completedIds.length >= sessions.length,
  };
};

// ---------------------------------------------------------------------------
// markSessionCompletedDirectly
// Force completes a session from the dashboard calendar for testing.
// ---------------------------------------------------------------------------
export const markSessionCompletedDirectly = async (sessionId: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from('session_progress')
    .select('id')
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .single();

  if (existing) {
    await supabase
      .from('session_progress')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('session_progress')
      .insert({
        session_id: sessionId,
        student_id: user.id,
        status: 'completed',
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        total_active_seconds: 120, // placeholder active time
        break_count: 0,
      });
  }
};

// ---------------------------------------------------------------------------
// resetSessionProgressDirectly
// Removes progress tracking for a session from the dashboard calendar for testing.
// ---------------------------------------------------------------------------
export const resetSessionProgressDirectly = async (sessionId: string) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: progress } = await supabase
    .from('session_progress')
    .select('id')
    .eq('session_id', sessionId)
    .eq('student_id', user.id)
    .single();

  if (progress) {
    // Delete any child break records first
    await supabase
      .from('break_records')
      .delete()
      .eq('session_progress_id', progress.id);

    // Delete session progress row
    await supabase
      .from('session_progress')
      .delete()
      .eq('id', progress.id);
  }
};

// ---------------------------------------------------------------------------
// recordPracticeResponse
// Inserts or updates a session_responses row for a lesson practice question.
// ---------------------------------------------------------------------------
export const recordPracticeResponse = async (
  sessionId: string,
  sectionId: string,
  isCorrect: boolean,
  attempts: number,
  timeTakenSeconds: number
) => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from('session_responses')
    .select('id')
    .eq('student_id', user.id)
    .eq('session_id', sessionId)
    .eq('section_id', sectionId)
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('session_responses')
      .update({
        is_correct: isCorrect,
        attempts: attempts,
        time_taken_seconds: timeTakenSeconds,
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('session_responses')
      .insert({
        student_id: user.id,
        session_id: sessionId,
        section_id: sectionId,
        response_type: 'practice',
        is_correct: isCorrect,
        attempts: attempts,
        time_taken_seconds: timeTakenSeconds,
      });
  }

  // Trigger Progress Engine
  try {
    await recomputeProgress(user.id);
  } catch (err) {
    console.error('Error recomputing progress on practice response:', err);
  }
};


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
    .eq('chapters.grade_level', 2)
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
  const { data } = await supabase
    .from('quizzes')
    .select('id, title, week_id')
    .limit(1)
    .single();
  return data;
};

// ---------------------------------------------------------------------------
// generateQuestionInstance (Phase 8 Deterministic Helper)
// Generates parameters, computes correctAnswer, and builds distractor choices.
// ---------------------------------------------------------------------------
const generateQuestionInstance = (temp: any) => {
  const aMin = Number(temp.param_a_min ?? 10);
  const aMax = Number(temp.param_a_max ?? 99);
  const bMin = Number(temp.param_b_min ?? 10);
  const bMax = Number(temp.param_b_max ?? 99);

  let a = 0;
  let b = 0;
  let tries = 0;

  // Check if this template's distractor rules require regrouping
  const rules = Array.isArray(temp.distractor_rules) ? temp.distractor_rules : [];
  const hasRegrouping = rules.some((r: any) =>
    r.type === 'forgot_carry' || r.type === 'forgot_carry_hundreds' || r.type === 'add_regrouped_to_ones'
  );

  while (tries < 100) {
    a = Math.floor(Math.random() * (aMax - aMin + 1)) + aMin;
    b = Math.floor(Math.random() * (bMax - bMin + 1)) + bMin;

    const onesA = a % 10;
    const onesB = b % 10;

    if (!hasRegrouping) {
      // Must not regroup: ones sum <= 9
      if (onesA + onesB <= 9) {
        break;
      }
    } else {
      // Must regroup: ones sum > 9
      if (onesA + onesB > 9) {
        break;
      }
    }
    tries++;
  }

  const correctAnswer = a + b;
  const distractors: any[] = [];

  rules.forEach((rule: any) => {
    let val = 0;
    let explanation = '';

    if (rule.type === 'forgot_carry') {
      val = correctAnswer - 10;
      explanation = 'Forgets to add the regrouped 10 to the tens column.';
    } else if (rule.type === 'forgot_carry_hundreds') {
      val = correctAnswer - 100;
      explanation = 'Forgets the carry to the hundreds place.';
    } else if (rule.type === 'off_by_one') {
      val = correctAnswer + (Math.random() > 0.5 ? 1 : -1);
      explanation = 'Counting error (off by one).';
    } else if (rule.type === 'off_by_ten') {
      val = correctAnswer + (Math.random() > 0.5 ? 10 : -10);
      explanation = 'Counting error (off by ten).';
    } else if (rule.type === 'subtract_instead') {
      val = a - b;
      explanation = 'Subtracted the numbers instead of adding.';
    } else if (rule.type === 'add_regrouped_to_ones') {
      val = correctAnswer + 1;
      explanation = 'Adds the carried ten to the ones column instead of the tens column.';
    } else {
      val = correctAnswer + 5;
      explanation = 'Calculated incorrectly.';
    }

    if (val !== correctAnswer && !distractors.some(d => d.value === val) && val > 0) {
      distractors.push({
        value: val,
        misconceptionTag: rule.misconceptionTag,
        explanation: rule.description || explanation,
      });
    }
  });

  // Ensure exactly 3 distractors
  let fillTries = 0;
  while (distractors.length < 3 && fillTries < 20) {
    const offset = [1, -1, 10, -10, 2, -2][distractors.length % 6];
    const val = correctAnswer + offset;
    if (val !== correctAnswer && !distractors.some(d => d.value === val) && val > 0) {
      distractors.push({
        value: val,
        misconceptionTag: 'off_by_one',
        explanation: 'Calculated incorrectly.',
      });
    }
    fillTries++;
  }

  return {
    a,
    b,
    correctAnswer,
    distractors: distractors.sort(() => Math.random() - 0.5),
  };
};

// ---------------------------------------------------------------------------
// startQuizAttempt
// Calls the start_quiz_attempt Postgres RPC function, selects N templates
// adaptively based on student_progress, generates instances, and bulk inserts them.
// ---------------------------------------------------------------------------
export const startQuizAttempt = async (quizId: string) => {
  // 1. Call RPC to verify unlock conditions and get attempt UUID
  const { data: attemptId, error } = await supabase
    .rpc('start_quiz_attempt', { p_quiz_id: quizId });
  if (error) throw error;

  // Check if questions are already generated for this attempt (resuming scenario)
  const { data: existingQuestions } = await supabase
    .from('quiz_attempt_questions')
    .select('id')
    .eq('quiz_attempt_id', attemptId)
    .limit(1);

  if (existingQuestions && existingQuestions.length > 0) {
    return attemptId as string;
  }

  // 2. Fetch student's progress to identify weak topics
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthenticated');

  const { data: progress } = await supabase
    .from('student_progress')
    .select('topic_id, primary_misconception_tag, mastery_status')
    .eq('student_id', user.id);

  const weakTopics = (progress ?? []).filter((p: any) => p.mastery_status === 'weak');
  const weakTopicIds = weakTopics.map((w: any) => w.topic_id);
  const weakMisconceptions = weakTopics.map((w: any) => w.primary_misconception_tag).filter(Boolean);

  // 3. Load all Chapter 1 templates
  const { data: templates, error: tError } = await supabase
    .from('questions')
    .select('id, topic_id, template, param_a_min, param_a_max, param_b_min, param_b_max, distractor_rules');

  if (tError || !templates || templates.length === 0) {
    throw new Error('No question templates available in the database');
  }

  // 4. Implement Adaptive Selection Rule (N = 7)
  const N = 7;
  const selectedTemplates: any[] = [];

  // Separate templates into weak-biased and general
  const weakBiasedTemplates = templates.filter(t => {
    const topicMatches = weakTopicIds.includes(t.topic_id);
    const rulesList = Array.isArray(t.distractor_rules) ? t.distractor_rules : [];
    const misconceptionMatches = rulesList.some((r: any) => weakMisconceptions.includes(r.misconceptionTag));
    return topicMatches || misconceptionMatches;
  });

  const generalTemplates = templates.filter(t => !weakBiasedTemplates.includes(t));

  let weakSelectedCount = 0;
  let generalSelectedCount = 0;

  const shuffle = (arr: any[]) => [...arr].sort(() => Math.random() - 0.5);
  const shuffledWeak = shuffle(weakBiasedTemplates);
  const shuffledGeneral = shuffle(generalTemplates);

  const targetWeakCount = Math.min(Math.ceil(N / 2), shuffledWeak.length); // Bias roughly half

  // Select weak-biased templates
  for (let i = 0; i < targetWeakCount; i++) {
    selectedTemplates.push(shuffledWeak[i]);
    weakSelectedCount++;
  }

  // Fill the rest with general templates
  const needed = N - selectedTemplates.length;
  for (let i = 0; i < needed; i++) {
    if (shuffledGeneral[i]) {
      selectedTemplates.push(shuffledGeneral[i]);
      generalSelectedCount++;
    } else {
      const remainingWeak = shuffledWeak.slice(targetWeakCount);
      if (remainingWeak[i - generalSelectedCount]) {
        selectedTemplates.push(remainingWeak[i - generalSelectedCount]);
        weakSelectedCount++;
      }
    }
  }

  // 5. Generate instances
  const quizAttemptQuestions: any[] = [];
  for (let idx = 0; idx < selectedTemplates.length; idx++) {
    const temp = selectedTemplates[idx];
    const instance = generateQuestionInstance(temp);
    quizAttemptQuestions.push({
      quiz_attempt_id: attemptId,
      template_id: temp.id,
      param_a: instance.a,
      param_b: instance.b,
      correct_answer: instance.correctAnswer,
      distractors: instance.distractors,
      order_index: idx,
    });
  }

  // 6. Bulk insert generated questions
  const { error: insError } = await supabase
    .from('quiz_attempt_questions')
    .insert(quizAttemptQuestions);

  if (insError) throw insError;

  // 7. Log decision
  await supabase
    .from('agent_decisions')
    .insert({
      student_id: user.id,
      agent_name: 'quiz_agent',
      decision_type: 'questions_selected',
      linked_entity_id: attemptId,
      input_snapshot: {
        weak_topics: weakTopics,
        misconception_tags_considered: weakMisconceptions,
      },
      output: {
        template_ids_selected: selectedTemplates.map(t => t.id),
        weak_biased_count: weakSelectedCount,
        general_count: generalSelectedCount,
      },
    });

  return attemptId as string;
};

// ---------------------------------------------------------------------------
// getQuizAttemptDetails
// Fetches details of a specific quiz attempt, including the time_limit_seconds.
// ---------------------------------------------------------------------------
export const getQuizAttemptDetails = async (attemptId: string) => {
  const { data, error } = await supabase
    .from('quiz_attempts')
    .select('time_limit_seconds, started_at')
    .eq('id', attemptId)
    .single();
  if (error) throw error;
  return data;
};

// ---------------------------------------------------------------------------
// getQuizQuestions
// Queries the `quiz_attempt_questions` table for a specific attempt, joining the
// template table to fetch the text template layout.
// ---------------------------------------------------------------------------
export const getQuizQuestions = async (attemptId: string) => {
  const { data, error } = await supabase
    .from('quiz_attempt_questions')
    .select('id, param_a, param_b, correct_answer, distractors, questions(template)')
    .eq('quiz_attempt_id', attemptId)
    .order('order_index', { ascending: true });

  if (error || !data) return [];

  return data.map((q: any) => ({
    id: q.id, // References quiz_attempt_questions.id
    template: q.questions?.template || '{a} + {b} = ?',
    a: Number(q.param_a),
    b: Number(q.param_b),
    correctAnswer: Number(q.correct_answer),
    distractors: (q.distractors || []) as Array<{
      value: number;
      misconceptionTag: string;
      explanation: string;
    }>,
  }));
};

// ---------------------------------------------------------------------------
// submitQuizAnswer
// Determines correctness of a dynamic question instance and writes the response.
// ---------------------------------------------------------------------------
export const submitQuizAnswer = async (
  attemptId: string,
  questionId: string, // quiz_attempt_questions.id
  selectedAnswer: number,
  timeTakenSeconds: number
) => {
  const { data: q, error: qError } = await supabase
    .from('quiz_attempt_questions')
    .select('correct_answer, distractors')
    .eq('id', questionId)
    .single();

  if (qError || !q) {
    throw new Error('Question not found');
  }

  const correctAnswer = Number(q.correct_answer);
  const isCorrect = correctAnswer === selectedAnswer;

  let misconceptionTag = null;
  if (!isCorrect && Array.isArray(q.distractors)) {
    const distractor = q.distractors.find((d: any) => Number(d.value) === selectedAnswer);
    if (distractor) {
      misconceptionTag = distractor.misconceptionTag || distractor.misconception_tag || null;
    }
  }

  const { error: insertError } = await supabase
    .from('quiz_responses')
    .insert({
      quiz_attempt_id: attemptId,
      question_id: questionId,
      selected_answer: selectedAnswer,
      is_correct: isCorrect,
      time_taken_seconds: timeTakenSeconds,
      misconception_tag: misconceptionTag,
    });

  if (insertError) {
    throw insertError;
  }

  return { isCorrect, misconceptionTag };
};

// ---------------------------------------------------------------------------
// completeQuizAttempt
// Aggregates responses to calculate total score and accuracy, completing the attempt.
// ---------------------------------------------------------------------------
export const completeQuizAttempt = async (attemptId: string) => {
  // Fetch attempt to identify quiz
  const { data: attempt, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('quiz_id')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) throw new Error('Attempt not found');

  // Count the number of questions actually generated for this specific attempt
  const { data: attemptQuestions } = await supabase
    .from('quiz_attempt_questions')
    .select('id')
    .eq('quiz_attempt_id', attemptId);

  const totalQuestions = attemptQuestions?.length || 7;

  // Retrieve student's submitted responses
  const { data: responses } = await supabase
    .from('quiz_responses')
    .select('is_correct')
    .eq('quiz_attempt_id', attemptId);

  const submittedResponses = responses ?? [];
  const correctCount = submittedResponses.filter((r: any) => r.is_correct).length;
  const submittedCount = submittedResponses.length;

  const scorePercentage = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
  const accuracyPercentage = submittedCount > 0 ? (correctCount / submittedCount) * 100 : 0;

  // Complete attempt
  const { error: updateError } = await supabase
    .from('quiz_attempts')
    .update({
      completed_at: new Date().toISOString(),
      score: scorePercentage,
      accuracy: accuracyPercentage,
      status: 'completed',
    })
    .eq('id', attemptId);

  if (updateError) throw updateError;

  // Trigger Recompute progress and generate report — run both independently
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    try {
      await recomputeProgress(user.id);
    } catch (err) {
      console.error('Error in progress engine (non-fatal):', err);
    }
    try {
      await generateReport(user.id, attemptId);
    } catch (err) {
      console.error('Error in report engine (non-fatal):', err);
    }
  }

  return {
    correctCount,
    totalQuestions,
    scorePercentage,
    accuracyPercentage,
  };
};

// ---------------------------------------------------------------------------
// getLearnerProfile
// Reads the real profiles row for the authenticated user along with progress.
// ---------------------------------------------------------------------------
export const getLearnerProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, grade_level, preferred_explanation_style, streak_days')
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
    streakDays: profile.streak_days,
    completedLessons: [] as string[],
    weakConcepts,
    masteredConcepts,
    quizHistory,
  };
};

// ---------------------------------------------------------------------------
// getAttentionStatus — unchanged, still reads mock JSON (Phase 4+)
// ---------------------------------------------------------------------------
export const getAttentionStatus = async () => {
  return attentionEventsData;
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
    .eq('chapters.grade_level', 2)
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
// getStreakData — reads profiles.streak_days for the current user
// ---------------------------------------------------------------------------
export const getStreakData = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { streakDays: 0 };

  const { data: profile } = await supabase
    .from('profiles')
    .select('streak_days')
    .eq('id', user.id)
    .single();

  return { streakDays: profile?.streak_days ?? 0 };
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
    .select('name, streak_days')
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
    streakDays: profile.streak_days,
    recentScores,
    flaggedTopics,
  };
};

// ---------------------------------------------------------------------------
// getRandomCheckInQuestion — unchanged, still reads mock JSON (Phase 4+)
// ---------------------------------------------------------------------------
export const getRandomCheckInQuestion = async () => {
  const randomIndex = Math.floor(Math.random() * checkInQuestions.length);
  return checkInQuestions[randomIndex];
};

// ---------------------------------------------------------------------------
// recomputeProgress (Phase 7 Progress Analysis Engine)
// Computes mastery_status and primary_misconception_tag based on quiz & session responses.
// ---------------------------------------------------------------------------
export const recomputeProgress = async (studentId: string) => {
  // Fetch completed quiz responses, resolving topic_id via quiz_attempt_questions -> questions
  const { data: quizResponses, error: qError } = await supabase
    .from('quiz_responses')
    .select(`
      is_correct,
      misconception_tag,
      quiz_attempt_id,
      quiz_attempts!inner(student_id, status),
      quiz_attempt_questions!inner(template_id, questions!inner(topic_id))
    `)
    .eq('quiz_attempts.student_id', studentId)
    .eq('quiz_attempts.status', 'completed');

  if (qError) {
    console.warn('[Progress Engine] quiz_responses join error (non-fatal):', qError.message);
  }

  // Fetch session responses
  const { data: sessionResponses, error: sError } = await supabase
    .from('session_responses')
    .select(`
      is_correct,
      misconception_tag,
      sessions!inner(topic_id, topic_name)
    `)
    .eq('student_id', studentId);

  if (sError) throw sError;

  // Fetch all unique topic mappings
  const { data: allSessions } = await supabase
    .from('sessions')
    .select('topic_id, topic_name')
    .filter('topic_id', 'not.is', null);

  const topicNameMap: Record<string, string> = {};
  (allSessions ?? []).forEach((s: any) => {
    if (s.topic_id) {
      topicNameMap[s.topic_id] = s.topic_name || s.topic_id;
    }
  });

  // Group responses by topic
  const topicData: Record<string, { correct: number; total: number; misconceptions: Record<string, number> }> = {};

  (quizResponses ?? []).forEach((qr: any) => {
    const topicId = qr.quiz_attempt_questions?.questions?.topic_id;
    if (!topicId) return;
    if (!topicData[topicId]) {
      topicData[topicId] = { correct: 0, total: 0, misconceptions: {} };
    }
    topicData[topicId].total += 1;
    if (qr.is_correct) {
      topicData[topicId].correct += 1;
    } else if (qr.misconception_tag) {
      const tag = qr.misconception_tag;
      topicData[topicId].misconceptions[tag] = (topicData[topicId].misconceptions[tag] || 0) + 1;
    }
  });

  (sessionResponses ?? []).forEach((sr: any) => {
    const topicId = sr.sessions?.topic_id;
    if (!topicId) return;
    if (!topicData[topicId]) {
      topicData[topicId] = { correct: 0, total: 0, misconceptions: {} };
    }
    topicData[topicId].total += 1;
    if (sr.is_correct) {
      topicData[topicId].correct += 1;
    } else if (sr.misconception_tag) {
      const tag = sr.misconception_tag;
      topicData[topicId].misconceptions[tag] = (topicData[topicId].misconceptions[tag] || 0) + 1;
    }
  });

  // Recompute and upsert mastery status
  for (const topicId of Object.keys(topicData)) {
    const stats = topicData[topicId];
    const accuracy = stats.total > 0 ? (stats.correct / stats.total) * 100 : 0;

    let primaryMisconception: string | null = null;
    let maxCount = 0;
    let recur = false;

    for (const [tag, count] of Object.entries(stats.misconceptions)) {
      if (count > maxCount) {
        maxCount = count;
        primaryMisconception = tag;
      }
      if (count >= 2) {
        recur = true;
      }
    }

    let masteryStatus: 'weak' | 'mastered' | 'in_progress' = 'in_progress';
    if (accuracy < 60 || recur) {
      masteryStatus = 'weak';
    } else if (accuracy >= 85 && stats.total >= 3) {
      masteryStatus = 'mastered';
    }

    const topicName = topicNameMap[topicId] || topicId;

    await supabase
      .from('student_progress')
      .upsert({
        student_id: studentId,
        topic_id: topicId,
        topic_name: topicName,
        mastery_status: masteryStatus,
        primary_misconception_tag: primaryMisconception,
        last_updated: new Date().toISOString()
      }, {
        onConflict: 'student_id,topic_id'
      });
  }
};

// ---------------------------------------------------------------------------
// generateReport (Phase 7 Report Agent)
// Computes stats delta & trend and generates a report with narrative explanation.
// ---------------------------------------------------------------------------
export const generateReport = async (studentId: string, attemptId: string) => {
  const { data: attempts, error: aError } = await supabase
    .from('quiz_attempts')
    .select('id, score, accuracy, started_at, completed_at')
    .eq('student_id', studentId)
    .eq('status', 'completed')
    .order('completed_at', { ascending: true });

  if (aError || !attempts || attempts.length === 0) return;

  const currentIndex = attempts.findIndex((a: any) => a.id === attemptId);
  if (currentIndex === -1) return;

  const currentAttempt = attempts[currentIndex];
  const prevAttempt = currentIndex > 0 ? attempts[currentIndex - 1] : null;

  const currentScore = Number(currentAttempt.score);
  const previousScore = prevAttempt ? Number(prevAttempt.score) : null;
  const scoreDelta = prevAttempt ? (currentScore - previousScore!) : 0;

  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  const totalCompleted = currentIndex + 1;

  if (totalCompleted === 2) {
    const acc0 = Number(attempts[0].accuracy);
    const acc1 = Number(attempts[1].accuracy);
    if (acc1 > acc0) trend = 'improving';
    else if (acc1 < acc0) trend = 'declining';
  } else if (totalCompleted >= 3) {
    const latestAcc = Number(attempts[currentIndex].accuracy);
    const prevAccAvg = (Number(attempts[currentIndex - 1].accuracy) + Number(attempts[currentIndex - 2].accuracy)) / 2;
    if (latestAcc > prevAccAvg) trend = 'improving';
    else if (latestAcc < prevAccAvg) trend = 'declining';
  }

  const { data: progress } = await supabase
    .from('student_progress')
    .select('topic_id, topic_name, mastery_status, primary_misconception_tag')
    .eq('student_id', studentId);

  const weak_topics = (progress ?? [])
    .filter((p: any) => p.mastery_status === 'weak')
    .map((p: any) => ({
      topic_id: p.topic_id,
      topic_name: p.topic_name,
      primary_misconception_tag: p.primary_misconception_tag
    }));

  const strong_topics = (progress ?? [])
    .filter((p: any) => p.mastery_status === 'mastered')
    .map((p: any) => ({
      topic_id: p.topic_id,
      topic_name: p.topic_name
    }));

  const statsSnapshot = {
    current_score: currentScore,
    previous_score: previousScore,
    score_delta: scoreDelta,
    trend: trend,
    weak_topics: weak_topics,
    strong_topics: strong_topics
  };

  const narrative = await generateNarrative(statsSnapshot);

  const { data: report, error: rError } = await supabase
    .from('reports')
    .insert({
      student_id: studentId,
      quiz_attempt_id: attemptId,
      stats_snapshot: statsSnapshot,
      narrative: narrative
    })
    .select()
    .single();

  if (rError) {
    console.error('Failed to save report:', rError);
    return;
  }

  await supabase
    .from('agent_decisions')
    .insert({
      student_id: studentId,
      agent_name: 'report_agent',
      decision_type: 'report_generated',
      linked_entity_id: report.id,
      input_snapshot: statsSnapshot,
      output: { narrative_summary: narrative.substring(0, 100) },
      reasoning_summary: JSON.stringify({
        comment: 'Report generated based on deterministic stats analysis.',
        trend_calculated: trend,
        delta: scoreDelta
      })
    });
};

// ---------------------------------------------------------------------------
// getReports
// Fetches past reports for the authenticated student.
// ---------------------------------------------------------------------------
export const getReports = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('student_id', user.id)
    .order('generated_at', { ascending: false });

  if (error) throw error;
  return data || [];
};

// ---------------------------------------------------------------------------
// getDynamicExplanation (Phase 8 RAG-Grounded Teaching Agent)
// Semantically queries curriculum_embeddings and uses Gemini to generate explanation.
// ---------------------------------------------------------------------------
export const getDynamicExplanation = async (
  sectionId: string,
  topicId: string,
  chapterId: string,
  style: string,
  gradeLevel: number,
  originalContent: string,
  forceNew: boolean = false
): Promise<string> => {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!geminiKey) {
    console.warn('[Teaching Agent] VITE_GEMINI_API_KEY not set. Falling back to static content.');
    return originalContent;
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    // 1. Call Gemini Embeddings API to embed the search context
    const embedResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: originalContent }] },
          outputDimensionality: 768
        })
      }
    );

    if (!embedResponse.ok) {
      const errBody = await embedResponse.text();
      throw new Error(`Embedding API error ${embedResponse.status}: ${errBody}`);
    }

    const embedJson = await embedResponse.json();
    const vector = embedJson.embedding?.values;
    if (!vector) {
      throw new Error('Failed to retrieve vector values from embedding response');
    }

    // 2. Call pgvector similarity search RPC match_curriculum_embeddings
    const { data: chunks, error: rpcError } = await supabase
      .rpc('match_curriculum_embeddings', {
        query_embedding: vector,
        match_threshold: 0.1,
        match_count: 3,
        p_topic_id: topicId,
        p_chapter_id: chapterId
      });

    if (rpcError) {
      throw rpcError;
    }

    const validChunks = chunks || [];

    // 3. Build prompt for Gemini LLM
    const styleDescription = style === 'analogy'
      ? 'Analogy-rich (use relatable, engaging analogies, scenarios, or stories suitable for 7-8 year olds)'
      : 'Clear and direct (broken down step-by-step, simple, friendly, and structured)';

    const prompt = `You are an expert teaching agent specializing in early childhood math education.
Your task is to explain a math concept to a student.

Student Context:
- Grade Level: Grade ${gradeLevel}
- Explanation Style: ${styleDescription}

Reference Curriculum Context Chunks (ground your explanation on these facts):
${validChunks.map((c: any) => `- ${c.source_text}`).join('\n')}

Original Lesson Section Content:
${originalContent}

Instruction:
Generate a fresh, highly engaging, and clear explanation of this concept based on the reference curriculum context.
Ensure it is written exactly for a Grade ${gradeLevel} student.
If the style is Analogy-rich, use a creative and relatable analogy (e.g. comparing numbers to marble bags, boxes, trees, etc.).
Ensure it is friendly, encouraging, and easy to read. Do not use complex language.
${forceNew ? 'Write this in a fresh, different way than before. Vary the phrasing, metaphors, and sentence structure.' : ''}

Response:`;
    // 4. Generate dynamic explanation using gemini-3.6-flash
    const llmResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        })
      }
    );

    if (!llmResponse.ok) {
      const errBody = await llmResponse.text();
      throw new Error(`LLM API error ${llmResponse.status}: ${errBody}`);
    }

    const llmJson = await llmResponse.json();
    const explanation = llmJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!explanation) {
      throw new Error('Empty explanation returned from LLM');
    }

    // 5. Log to agent_decisions
    const chunkIds = validChunks.map((c: any) => c.session_section_id || c.id);
    await supabase.from('agent_decisions').insert({
      student_id: user?.id,
      agent_name: 'teaching_agent',
      decision_type: 'explanation_generated',
      linked_entity_id: sectionId,
      input_snapshot: {
        style,
        grade_level: gradeLevel,
        topic_id: topicId,
        chapter_id: chapterId,
      },
      output: {
        retrieved_context_ids: chunkIds,
        generated_text: explanation.trim(),
      },
      reasoning_summary: `Generated explanation in ${style} style for Grade ${gradeLevel} using ${validChunks.length} curriculum context chunks.`
    });

    return explanation.trim();

  } catch (err) {
    console.error('[Teaching Agent] Dynamic explanation generation failed:', err);
    return originalContent;
  }
};

// ---------------------------------------------------------------------------
// askMathAgent (Phase 8 RAG-Grounded Teaching Agent Q&A)
// Answers student questions dynamically by fetching context chunks from
// curriculum_embeddings using similarity search and generating a response.
// ---------------------------------------------------------------------------
export const askMathAgent = async (
  sectionId: string,
  topicId: string,
  chapterId: string,
  query: string,
  gradeLevel: number
): Promise<string> => {
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;

  if (!geminiKey) {
    console.warn('[Teaching Agent] Gemini key missing. Returning default message.');
    return "I would love to help you, but the Gemini API key is missing. Please verify your settings!";
  }

  try {
    const { data: { user } } = await supabase.auth.getUser();
    // 1. Call Gemini Embeddings API to embed the student's query
    const embedResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: query }] },
          outputDimensionality: 768
        })
      }
    );

    if (!embedResponse.ok) {
      throw new Error(`Embedding API returned status ${embedResponse.status}`);
    }

    const embedJson = await embedResponse.json();
    const vector = embedJson.embedding?.values;
    if (!vector) {
      throw new Error('Failed to retrieve vector values from embedding response');
    }

    // 2. Call pgvector similarity search RPC match_curriculum_embeddings
    const { data: chunks, error: rpcError } = await supabase
      .rpc('match_curriculum_embeddings', {
        query_embedding: vector,
        match_threshold: 0.1,
        match_count: 3,
        p_topic_id: topicId,
        p_chapter_id: chapterId
      });

    if (rpcError) {
      throw rpcError;
    }

    const validChunks = chunks || [];

    // 3. Build prompt for Gemini LLM
    const prompt = `You are a friendly, encouraging AI Math Assistant for elementary school students.
A student in Grade ${gradeLevel} has asked you a question about a math lesson.

Student Question:
"${query}"

Reference Curriculum Context (ground your answer ONLY on these facts and concepts):
${validChunks.map((c: any) => `- ${c.source_text}`).join('\n')}

Instruction:
Answer the student's question clearly, simply, and step-by-step.
Keep the language extremely friendly and appropriate for a Grade ${gradeLevel} student (about 7-8 years old).
Ground your facts in the reference curriculum context.
Use analogies or simple examples if they make it easier to understand (e.g. cookies, marbles, lanes).
Do not use complicated math terminology unless you define it simply first.

Response:`;

    // 4. Call Gemini LLM to generate response
    const llmResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        })
      }
    );

    if (!llmResponse.ok) {
      throw new Error(`LLM API returned status ${llmResponse.status}`);
    }

    const llmJson = await llmResponse.json();
    const answer = llmJson.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!answer) {
      throw new Error('Empty answer returned from LLM');
    }

    // 5. Log decision
    const chunkIds = validChunks.map((c: any) => c.session_section_id || c.id);
    await supabase.from('agent_decisions').insert({
      student_id: user?.id,
      agent_name: 'teaching_agent',
      decision_type: 'student_query_answered',
      linked_entity_id: sectionId,
      input_snapshot: {
        query,
        grade_level: gradeLevel,
        topic_id: topicId,
        chapter_id: chapterId,
      },
      output: {
        retrieved_context_ids: chunkIds,
        generated_answer: answer.trim(),
      },
      reasoning_summary: `Answered student query: "${query}" using ${validChunks.length} curriculum context chunks.`
    });

    return answer.trim();

  } catch (err) {
    console.error('[Teaching Agent] Query answering failed:', err);
    return "I'm sorry, I had trouble finding the answer to that question. Please try asking in a different way, or check your internet connection!";
  }
};

// ---------------------------------------------------------------------------
// getStudentAgentDecisions
// Fetches chronological agent decisions for a student.
// ---------------------------------------------------------------------------
export const getStudentAgentDecisions = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('agent_decisions')
    .select('*')
    .eq('student_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch agent decisions:', error);
    throw error;
  }
  return data || [];
};
