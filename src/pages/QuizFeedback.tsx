import React, { useState, useEffect, useEffectEvent, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWeeklyProgress, getWeeklyQuiz, startQuizAttempt, submitQuizAnswer, completeQuizAttempt } from '../services/api';
import type { QuizQuestion, QuizResult } from '../services/backendClient';
import { QuizCelebration } from '../components/QuizCelebration';
import { useSettings } from '../context/SettingsContext';
import { ArrowRight, AlertCircle, CheckCircle2, Lock, Clock, XCircle, HelpCircle } from 'lucide-react';

type ScreenState = 'loading' | 'locked' | 'intro' | 'questions' | 'summary' | 'error';
interface SessionProgress { sessionId: string; dayNumber: number; title: string; sessionType: string; status: string }

export const QuizFeedback = () => {
  const navigate = useNavigate();
  const {reduceMotion}=useSettings();
  const [celebrating,setCelebrating]=useState(false);
  const [screen, setScreen] = useState<ScreenState>('loading');
  const [incompleteSessions, setIncompleteSessions] = useState<SessionProgress[]>([]);
  const [quiz, setQuiz] = useState<any>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ isCorrect: boolean; explanation?: string } | null>(null);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const questionStarted = useRef(0);
  const deadline = useRef(0);
  const finishLock = useRef(false);
  const answerPending = useRef<Promise<unknown> | null>(null);
  const [summaryStats, setSummaryStats] = useState<QuizResult | null>(null);
  const [missedQuestions, setMissedQuestions] = useState<QuizResult['missedQuestions']>([]);
  const [isFinishing, setIsFinishing] = useState(false);

  const initialize = async () => {
    setScreen('loading');
    try {
      const progress = await getWeeklyProgress();
      const incomplete = progress.filter(s => s.status !== 'completed');
      setIncompleteSessions(incomplete);
      if (!progress.length || incomplete.length) { setScreen('locked'); return; }
      const available = await getWeeklyQuiz();
      if (!available) throw new Error('No assessment is available for your current lessons.');
      setQuiz(available); setScreen('intro');
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not load assessment.'); setScreen('error'); }
  };
  useEffect(() => { void initialize(); }, []);

  const finishQuiz = async (id = attemptId) => {
    if (!id || finishLock.current) return;
    finishLock.current = true; setIsFinishing(true); setScreen('loading');
    try {
      await answerPending.current;
      const stats = await completeQuizAttempt(id);
      setSummaryStats(stats); setMissedQuestions(stats.missedQuestions); setCelebrating(stats.fullMarks && !reduceMotion); setScreen('summary');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not save the assessment.'); setScreen('error');
    } finally { finishLock.current = false; setIsFinishing(false); }
  };
  const onTimeout = useEffectEvent(() => { void finishQuiz(); });
  useEffect(() => {
    if (screen !== 'questions') return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (!remaining) onTimeout();
    };
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [screen]);

  const handleStartQuiz = async () => {
    if (!quiz) return;
    setScreen('loading');
    try {
      const plan = await startQuizAttempt(quiz.id);
      setAttemptId(plan.attempt_id); setQuestions(plan.questions);
      const firstUnanswered = plan.questions.findIndex(q => !plan.answered_question_ids.includes(q.id));
      if (!plan.questions.length) throw new Error('This assessment has no questions. Please contact your teacher.');
      if (firstUnanswered < 0 || plan.remaining_seconds <= 0 || plan.status === 'completed') {
        await finishQuiz(plan.attempt_id); return;
      }
      setCurrentIndex(firstUnanswered); setTimeLeft(plan.remaining_seconds);
      deadline.current = Date.now() + plan.remaining_seconds * 1000;
      questionStarted.current = Date.now(); setScreen('questions');
    } catch (error) { setLoadError(error instanceof Error ? error.message : 'Could not start assessment.'); setScreen('error'); }
  };

  const handleSelect = async (opt: { value: number }) => {
    if (!attemptId || feedback || answerPending.current || finishLock.current) return;
    setSelectedAnswer(opt.value); setSubmitError(null); setIsSubmittingAnswer(true);
    const pending = submitQuizAnswer(attemptId, questions[currentIndex].id, opt.value, Math.max(0, Math.round((Date.now() - questionStarted.current)/1000)));
    answerPending.current = pending;
    try { setFeedback(await pending); }
    catch (error) { setSubmitError(error instanceof Error ? error.message : 'Could not save your answer.'); setSelectedAnswer(null); }
    finally { answerPending.current = null; setIsSubmittingAnswer(false); }
  };
  const handleNext = async () => {
    if (isSubmittingAnswer || !feedback) return;
    if (currentIndex >= questions.length - 1) { await finishQuiz(); return; }
    setCurrentIndex(index => index + 1); setSelectedAnswer(null); setFeedback(null); setSubmitError(null);
    questionStarted.current = Date.now();
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

  if (screen === 'error') return (
    <div role="alert" className="p-xl text-center">
      <p>{loadError}</p>
      <button className="mt-md px-6 py-3 bg-primary text-on-primary rounded-full" onClick={() => {
        if (attemptId) void finishQuiz(); else void initialize();
      }}>Retry</button>
      <button className="ml-4" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
    </div>
  );

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
  if (screen === 'questions' && questions[currentIndex]) {
    const question = questions[currentIndex];
    const qText = question.template.replace('{a}', String(question.a)).replace('{b}', String(question.b));

    const options = question.options.map(value => ({ value }));

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
                  disabled={feedback !== null || isSubmittingAnswer || isFinishing}
                  onClick={() => handleSelect(opt)}
                  className={`min-h-[80px] rounded-xl border-2 font-headline-md text-headline-md transition-all duration-200
                    ${selectedAnswer === opt.value
                      ? (feedback?.isCorrect ? 'bg-secondary-container border-primary text-primary' : 'bg-error-container border-error text-error')
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
              <CheckCircle2 size={32} />
            </div>
            {celebrating&&!reduceMotion&&<QuizCelebration onDone={()=>setCelebrating(false)} />}
            {summaryStats?.fullMarks&&reduceMotion&&<p role="status" className="text-primary font-bold">Every question correct. Well done!</p>}
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
                {Math.round(summaryStats?.accuracyPercentage ?? 0)}%
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
                      <span className="text-error">Your answer: {item.selectedAnswer ?? 'Skipped'}</span>
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
          ) : summaryStats?.fullMarks ? (
            <div className="mb-xl bg-secondary-container/20 border border-primary/20 rounded-xl p-md text-center">
              <CheckCircle2 className="text-primary mx-auto mb-2" size={28} />
              <p className="font-body-md text-primary font-bold">Perfect Score! No mistakes to review.</p>
            </div>
          ) : null}

          <button
            onClick={() => navigate(`/reports?attempt=${attemptId}`)}
            className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm"
          >
            View Report
          </button>
        </div>
      </div>
    );
  }

  return null;
};
