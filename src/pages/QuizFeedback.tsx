import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getWeeklyProgress,
  getWeeklyQuiz,
  startQuizAttempt,
  getQuizAttemptDetails,
  getQuizQuestions,
  submitQuizAnswer,
  completeQuizAttempt,
} from '../services/api';
import { supabase } from '../lib/supabaseClient';
import { useSettings } from '../context/SettingsContext';
import { speak } from '../services/voice';
import {
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Lock,
  Clock,
  Award,
  XCircle,
  HelpCircle,
} from 'lucide-react';

type ScreenState = 'loading' | 'locked' | 'intro' | 'questions' | 'summary';

interface SessionProgress {
  sessionId: string;
  dayNumber: number;
  title: string;
  sessionType: string;
  status: 'not_started' | 'in_progress' | 'completed';
}

export const QuizFeedback = () => {
  const navigate = useNavigate();
  const { voiceMode } = useSettings();

  // Screen state routing
  const [screen, setScreen] = useState<ScreenState>('loading');
  const [incompleteSessions, setIncompleteSessions] = useState<SessionProgress[]>([]);
  const [quiz, setQuiz] = useState<any>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  // Questions and responses state
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Timers
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Final summary stats
  const [summaryStats, setSummaryStats] = useState<any>(null);
  const [missedQuestions, setMissedQuestions] = useState<any[]>([]);
  const [isFinishing, setIsFinishing] = useState(false);

  // ── 1. Check Gating & Fetch Quiz ──────────────────────────────────────────
  useEffect(() => {
    const checkGatingAndLoad = async () => {
      try {
        const progress = await getWeeklyProgress();
        const incomplete = progress.filter((s: any) => s.status !== 'completed');

        if (incomplete.length > 0) {
          setIncompleteSessions(incomplete);
          setScreen('locked');
        } else {
          const weeklyQuiz = await getWeeklyQuiz();
          if (!weeklyQuiz) {
            setScreen('locked'); // fallback if no quiz seeded
            return;
          }
          setQuiz(weeklyQuiz);
          setScreen('intro');
        }
      } catch (err) {
        console.error('Error checking quiz gating:', err);
        setScreen('locked');
      }
    };
    checkGatingAndLoad();
  }, []);

  // ── 2. Handle Countdown Timer ─────────────────────────────────────────────
  useEffect(() => {
    if (screen === 'questions') {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            handleTimeOut();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [screen]); // Removed timeLeft to prevent tearing down interval every second

  // Reset question timer on index change
  useEffect(() => {
    if (screen === 'questions') {
      setQuestionStartTime(Date.now());
    }
  }, [currentIndex, screen]);

  // ── 3. Start Quiz Attempt ────────────────────────────────────────────────
  const handleStartQuiz = async () => {
    if (!quiz) return;
    setScreen('loading');
    try {
      // 1. Call RPC to verify unlock conditions and get attempt UUID
      const newAttemptId = await startQuizAttempt(quiz.id);
      setAttemptId(newAttemptId);

      // 2. Load questions
      const quizQuestions = await getQuizQuestions(newAttemptId);
      setQuestions(quizQuestions);

      // Fetch details of attempt to get real time limit
      const attemptDetails = await getQuizAttemptDetails(newAttemptId);
      
      // Calculate remaining time based on started_at and time_limit_seconds
      let limit = attemptDetails?.time_limit_seconds || (quizQuestions.length * 90);
      if (attemptDetails?.started_at) {
        const elapsed = Math.round((Date.now() - new Date(attemptDetails.started_at).getTime()) / 1000);
        if (elapsed > 0) {
          limit = Math.max(0, limit - elapsed);
        }
      }
      setTimeLeft(limit);

      // Fetch already submitted answers for this attempt (resuming scenario)
      const { data: dbAnswers } = await supabase
        .from('quiz_responses')
        .select('question_id, selected_answer')
        .eq('quiz_attempt_id', newAttemptId);

      let startIdx = 0;
      if (dbAnswers && dbAnswers.length > 0) {
        const answeredIds = dbAnswers.map((a: any) => a.question_id);
        const firstUnanswered = quizQuestions.findIndex(q => !answeredIds.includes(q.id));
        if (firstUnanswered !== -1) {
          startIdx = firstUnanswered;
        } else {
          startIdx = quizQuestions.length - 1; // all answered, show last
        }
      }

      setScreen('questions');
      setCurrentIndex(startIdx);
      setQuestionStartTime(Date.now());
    } catch (err: any) {
      console.error('Failed to start quiz attempt:', err);
      alert(err.message || 'Could not start quiz attempt. Ensure all sessions are completed.');
      navigate('/dashboard');
    }
  };

  // ── 4. Answer Selection ──────────────────────────────────────────────────
  const handleSelect = async (opt: any) => {
    if (!attemptId || selectedAnswer !== null || isSubmittingAnswer) return;
    setSelectedAnswer(opt.value);
    setSubmitError(null);

    const timeTaken = Math.round((Date.now() - questionStartTime) / 1000);
    const isCorrect = opt.value === questions[currentIndex].correctAnswer;

    setFeedback({
      isCorrect,
      explanation: isCorrect ? 'Great job! You got it right.' : opt.explanation
    });

    if (voiceMode) {
      speak(isCorrect ? 'Great job! You got it right.' : opt.explanation);
    }

    setIsSubmittingAnswer(true);
    try {
      // Record answer immediately to Supabase
      await submitQuizAnswer(attemptId, questions[currentIndex].id, opt.value, timeTaken);
    } catch (err) {
      console.error('Failed to record quiz response:', err);
      setSubmitError('Failed to save answer due to a network drop. Click this option again to retry.');
      setSelectedAnswer(null);
      setFeedback(null);
    } finally {
      setIsSubmittingAnswer(false);
    }
  };

  // ── 5. Next Question / Finish ─────────────────────────────────────────────
  const handleNext = async () => {
    if (isSubmittingAnswer) return;
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setFeedback(null);
      setSubmitError(null);
    } else {
      await finishQuiz();
    }
  };

  // ── 6. Complete Attempt ───────────────────────────────────────────────────
  const finishQuiz = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!attemptId || isFinishing) return;
    setIsFinishing(true);
    setScreen('loading');

    let retries = 3;
    while (retries > 0) {
      try {
        const stats = await completeQuizAttempt(attemptId);
        setSummaryStats(stats);

        // Fetch actual submitted responses for this attempt
        const { data: dbResponses } = await getWeeklyQuizResponses(attemptId);

        const missedList = questions.map(q => {
          const resp = (dbResponses ?? []).find((r: any) => r.question_id === q.id);
          return {
            questionText: q.template.replace('{a}', q.a).replace('{b}', q.b),
            correctAnswer: q.correctAnswer,
            selectedAnswer: resp ? resp.selected_answer : 'Skipped/No Answer',
            isCorrect: resp ? resp.is_correct : false,
            misconceptionTag: resp ? resp.misconception_tag : null,
          };
        }).filter(m => !m.isCorrect);

        setMissedQuestions(missedList);
        setScreen('summary');
        break; // Success!
      } catch (err) {
        console.error(`Failed to complete quiz (retries left: ${retries - 1}):`, err);
        retries--;
        if (retries === 0) {
          alert('Failed to save quiz completion due to a network connection issue. Click OK to try again.');
          setScreen('questions');
          setIsFinishing(false);
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  };

  const handleTimeOut = async () => {
    if (voiceMode) speak("Time's up! Let's review your results.");
    await finishQuiz();
  };

  // Helper function to load actual responses
  const getWeeklyQuizResponses = async (attId: string) => {
    return supabase
      .from('quiz_responses')
      .select('question_id, selected_answer, is_correct, misconception_tag')
      .eq('quiz_attempt_id', attId);
  };

  // Format seconds to mm:ss
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Render Helpers ────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[calc(100vh-64px)]">
        <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <span className="font-label-lg text-on-surface-variant">Loading Assessment...</span>
      </div>
    );
  }

  // Gating locked screen
  if (screen === 'locked') {
    return (
      <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)]">
        <div className="bg-surface rounded-2xl p-xxl shadow-[0_8px_32px_rgba(67,97,130,0.08)] border border-outline-variant/30 text-center max-w-xl w-full">
          <div className="bg-error-container/20 text-error w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-xl">
            <Lock size={32} />
          </div>
          <h2 className="font-headline-lg text-on-surface mb-md">Assessment Locked</h2>
          <p className="font-body-lg text-on-surface-variant mb-xl">
            Complete all Week 1 learning sessions and revision to unlock your assessment
          </p>

          <div className="text-left bg-surface-container-low rounded-xl p-md mb-xl">
            <h3 className="font-label-lg text-on-surface mb-sm">Outstanding Sessions:</h3>
            <ul className="flex flex-col gap-2">
              {incompleteSessions.map((s) => (
                <li key={s.sessionId} className="flex items-center gap-2 font-body-md text-on-surface-variant">
                  <div className="w-2.5 h-2.5 rounded-full bg-error" />
                  <span>Day {s.dayNumber}: {s.title} ({s.sessionType === 'revision' ? 'Revision' : 'Lesson'})</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={() => navigate('/dashboard')}
            className="w-full min-h-[48px] bg-primary text-on-primary font-label-lg rounded-full hover:bg-primary/90 transition-colors shadow-sm"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Welcome Intro Screen
  if (screen === 'intro') {
    return (
      <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)]">
        <div className="bg-surface rounded-2xl p-xxl shadow-[0_8px_32px_rgba(67,97,130,0.08)] border border-outline-variant/30 text-center max-w-xl w-full">
          <div className="bg-primary/10 text-primary w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-xl">
            <HelpCircle size={32} />
          </div>
          <h2 className="font-headline-lg text-on-surface mb-md">{quiz?.title || 'Weekly Assessment'}</h2>
          <p className="font-body-lg text-on-surface-variant mb-xl">
            Ready to show what you've learned? This quiz will assess your understanding of addition with regrouping.
          </p>
          <div className="bg-surface-container-low rounded-xl p-md mb-xl flex items-center justify-between text-on-surface-variant text-sm font-label-sm">
            <span>⏱️ Adaptive Time Limit</span>
            <span>📝 {questions.length > 0 ? questions.length : '7'} Questions</span>
          </div>
          <button
            onClick={handleStartQuiz}
            className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm"
          >
            Start Assessment
          </button>
        </div>
      </div>
    );
  }

  // Active Quiz Questions Screen
  if (screen === 'questions') {
    const question = questions[currentIndex];
    const qText = question.template.replace('{a}', question.a).replace('{b}', question.b);

    const options = [
      { value: question.correctAnswer, isCorrect: true },
      ...question.distractors.map((d: any) => ({ ...d, isCorrect: false })),
    ].sort((a, b) => a.value - b.value);

    return (
      <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)]">
        <div className="w-full max-w-container-max flex flex-col items-center">

          {/* Header Progress & Timer */}
          <div className="w-full max-w-2xl flex justify-between items-center mb-md font-label-sm text-on-surface-variant">
            <span>Question {currentIndex + 1} of {questions.length}</span>
            <span className="flex items-center gap-1.5 text-error font-bold">
              <Clock size={16} />
              {formatTime(timeLeft)}
            </span>
          </div>

          <div className="w-full max-w-2xl mb-xl">
            <div className="h-2 w-full bg-surface-variant rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${((currentIndex) / questions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question Card */}
          <div className="bg-surface rounded-xl p-xxl shadow-[0_4px_24px_rgba(67,97,130,0.08)] border border-surface-variant/50 w-full max-w-2xl mb-xl">
            <h2 className="font-display-lg text-display-lg text-on-surface text-center mb-xl font-bold">
              {qText}
            </h2>

            {submitError && (
              <div className="bg-error-container/20 border border-error/30 text-error p-md rounded-xl text-center mb-md font-body-sm flex items-center justify-center gap-2 animate-fade-in">
                <AlertCircle size={16} />
                <span>{submitError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-md">
              {options.map((opt, i) => (
                <button
                  key={i}
                  disabled={feedback !== null}
                  onClick={() => handleSelect(opt)}
                  className={`min-h-[80px] rounded-xl border-2 font-headline-md text-headline-md transition-all duration-200
                    ${selectedAnswer === opt.value
                      ? (opt.isCorrect ? 'bg-secondary-container border-primary text-primary' : 'bg-error-container border-error text-error')
                      : 'bg-surface border-outline-variant text-on-surface hover:border-primary hover:bg-surface-container-low'
                    }
                    ${feedback !== null && selectedAnswer !== opt.value ? 'opacity-50' : ''}
                  `}
                >
                  {opt.value}
                </button>
              ))}
            </div>
          </div>

          {/* Feedback Area */}
          {feedback && (
            <div className={`w-full max-w-2xl p-lg rounded-xl mb-xl flex items-start gap-md animate-fade-in
              ${feedback.isCorrect ? 'bg-secondary-container/50 border border-primary/20' : 'bg-error-container/50 border border-error/20'}
            `}>
              {feedback.isCorrect ? (
                <CheckCircle2 className="text-primary mt-1" size={24} />
              ) : (
                <AlertCircle className="text-error mt-1" size={24} />
              )}
              <div className="flex-1">
                <h3 className={`font-headline-md text-headline-md mb-2 ${feedback.isCorrect ? 'text-primary' : 'text-error'}`}>
                  {feedback.isCorrect ? 'Correct!' : 'Not quite.'}
                </h3>
                <p className="font-body-md text-on-surface-variant">{feedback.explanation}</p>
              </div>
              <button
                onClick={handleNext}
                className="px-6 py-3 rounded-full bg-primary text-on-primary font-label-lg flex items-center gap-2 hover:bg-primary-container transition-colors shrink-0"
              >
                {currentIndex < questions.length - 1 ? 'Next Question' : 'Finish Quiz'}
                <ArrowRight size={20} />
              </button>
            </div>
          )}

        </div>
      </div>
    );
  }

  // Summary Dashboard Screen
  if (screen === 'summary') {
    return (
      <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)]">
        <div className="bg-surface rounded-2xl p-xxl shadow-[0_8px_32px_rgba(67,97,130,0.08)] border border-outline-variant/30 max-w-2xl w-full">

          <div className="text-center mb-xl">
            <div className="bg-tertiary-container text-tertiary w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-md shadow-inner">
              <Award size={32} />
            </div>
            <h2 className="font-headline-lg text-on-surface">Assessment Summary</h2>
            <p className="font-body-md text-on-surface-variant mt-1">Great job finishing the assessment!</p>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-2 gap-md mb-xl">
            <div className="bg-surface-container-low rounded-xl p-md text-center border border-outline-variant/20">
              <span className="font-label-sm text-on-surface-variant block mb-1">Total Score</span>
              <span className="font-display-md text-[32px] font-bold text-primary">
                {summaryStats?.correctCount} / {summaryStats?.totalQuestions}
              </span>
            </div>
            <div className="bg-surface-container-low rounded-xl p-md text-center border border-outline-variant/20">
              <span className="font-label-sm text-on-surface-variant block mb-1">Accuracy</span>
              <span className="font-display-md text-[32px] font-bold text-secondary">
                {Math.round(summaryStats?.accuracyPercentage)}%
              </span>
            </div>
          </div>

          {/* Missed Questions */}
          {missedQuestions.length > 0 ? (
            <div className="mb-xl">
              <h3 className="font-label-lg text-on-surface mb-sm flex items-center gap-2">
                <XCircle size={18} className="text-error" />
                Areas to Review ({missedQuestions.length})
              </h3>
              <div className="flex flex-col gap-sm max-h-[220px] overflow-y-auto pr-1">
                {missedQuestions.map((item, index) => (
                  <div key={index} className="bg-error-container/10 border border-error/20 rounded-xl p-md text-left">
                    <p className="font-body-md text-on-surface font-semibold">{item.questionText}</p>
                    <div className="flex justify-between items-center mt-sm text-xs font-label-sm">
                      <span className="text-error">Your answer: {item.selectedAnswer}</span>
                      <span className="text-primary font-bold">Correct answer: {item.correctAnswer}</span>
                    </div>
                    {item.misconceptionTag && (
                      <p className="text-xs font-body-sm text-on-surface-variant mt-1 italic capitalize">
                        Misconception Identified: {item.misconceptionTag.replace(/_/g, ' ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-xl bg-secondary-container/20 border border-primary/20 rounded-xl p-md text-center">
              <CheckCircle2 className="text-primary mx-auto mb-2" size={28} />
              <p className="font-body-md text-primary font-bold">Perfect Score! No mistakes to review.</p>
            </div>
          )}

          <button
            onClick={() => navigate('/streaks')}
            className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm"
          >
            Continue to Celebration
          </button>
        </div>
      </div>
    );
  }

  return null;
};
