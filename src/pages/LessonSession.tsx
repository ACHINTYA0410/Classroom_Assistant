import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getNextLesson, recordPracticeResponse, getDynamicExplanation, askMathAgent } from '../services/api';
import { useSession } from '../context/SessionContext';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { speak } from '../services/voice';
import { Mic, FileText, ArrowRight, Lightbulb, CheckCircle2 } from 'lucide-react';

// Seconds of active time between attention check-ins (8 minutes)
const ATTENTION_INTERVAL_SECONDS = 480;

export const LessonSession = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { explanationStyle, setExplanationStyle, voiceMode, toggleVoiceMode, reduceMotion } = useSettings();
  const { startSession, markDone, flushTime, activeSeconds } = useSession();
  const { profile } = useAuth();

  const [lesson, setLesson] = useState<any>(null);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [allDone, setAllDone] = useState(false);

  // Dynamic Explanation state
  const [dynamicExplanation, setDynamicExplanation] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [genCount, setGenCount] = useState<number>(0);

  // Student Q&A state
  const [studentQuery, setStudentQuery] = useState<string>('');
  const [agentAnswer, setAgentAnswer] = useState<string>('');
  const [isAnswering, setIsAnswering] = useState<boolean>(false);

  // Practice state
  const [practiceAnswer, setPracticeAnswer] = useState<string>('');
  const [practiceAttempts, setPracticeAttempts] = useState<number>(0);
  const [practiceFeedback, setPracticeFeedback] = useState<{ isCorrect: boolean; message: string } | null>(null);
  const [isCheckingPractice, setIsCheckingPractice] = useState<boolean>(false);
  const [isMarkingDone, setIsMarkingDone] = useState<boolean>(false);

  // Timers
  const lastAttentionCheckRef = useRef(0);
  const sectionStartTimeRef = useRef(Date.now());

  const specificSessionId = location.state?.sessionId;

  // ── Section resolution ────────────────────────────────────────────────────
  const orderIndices = lesson
    ? (Array.from(new Set(lesson.sections.map((s: any) => s.orderIndex))).sort((a: any, b: any) => a - b) as number[])
    : [];
  const currentOrder = orderIndices[currentChunkIndex];
  const isLastSection = lesson ? currentChunkIndex === orderIndices.length - 1 : false;

  const availableSections = lesson
    ? lesson.sections.filter((s: any) => s.orderIndex === currentOrder)
    : [];
  let activeSection = availableSections.find((s: any) => s.explanationStyle === explanationStyle);
  if (!activeSection && lesson) {
    activeSection = availableSections.find((s: any) => s.explanationStyle === 'text')
      ?? availableSections[0];
    if (import.meta.env.DEV && activeSection) {
      // eslint-disable-next-line no-console
      console.warn(`[LessonSession] No "${explanationStyle}" section at index ${currentOrder}. Fell back to "${activeSection.explanationStyle}".`);
    }
  }

  const isPracticeLocked = activeSection?.sectionType === 'practice' && 
    activeSection?.questionPrompt && 
    !practiceFeedback?.isCorrect;

  // ── Load lesson + start session progress ─────────────────────────────────
  useEffect(() => {
    getNextLesson(specificSessionId).then(data => {
      if (!data) return;
      setLesson(data);
      setAllDone(data.allDone ?? false);
      startSession(data.sessionId);
    });
    return () => {
      flushTime().catch(console.error);
    };
  }, [specificSessionId, startSession, flushTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Attention monitor: trigger after every ATTENTION_INTERVAL_SECONDS ────
  useEffect(() => {
    const threshold = Math.floor(activeSeconds / ATTENTION_INTERVAL_SECONDS);
    if (threshold > lastAttentionCheckRef.current && activeSeconds > 0) {
      lastAttentionCheckRef.current = threshold;
      navigate('/attention');
    }
  }, [activeSeconds, navigate]);

  // Reset practice and dynamic states on section transition
  useEffect(() => {
    setPracticeAnswer('');
    setPracticeAttempts(0);
    setPracticeFeedback(null);
    setDynamicExplanation('');
    setStudentQuery('');
    setAgentAnswer('');
    setGenCount(0);
    sectionStartTimeRef.current = Date.now();
  }, [currentChunkIndex, lesson]);

  // Load dynamic explanation ONLY when genCount > 0 (student clicks "Explain it differently")
  useEffect(() => {
    if (activeSection && activeSection.sectionType === 'explanation' && genCount > 0) {
      setIsGenerating(true);
      getDynamicExplanation(
        activeSection.id,
        lesson.topicId,
        lesson.chapterId || '00000000-0000-0000-0000-000000000000',
        explanationStyle,
        profile?.grade_level || 2,
        activeSection.content,
        true
      )
        .then(explanation => {
          setDynamicExplanation(explanation);
          setIsGenerating(false);
        })
        .catch(err => {
          console.warn('[LessonSession] Failed to fetch dynamic explanation:', err);
          setDynamicExplanation(activeSection.content);
          setIsGenerating(false);
        });
    }
  }, [activeSection, explanationStyle, genCount, lesson, profile]);

  if (!lesson) return <div className="p-xl text-center">Loading...</div>;

  if (allDone) {
    return (
      <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)] text-center">
        <CheckCircle2 size={64} className="text-primary mb-lg" />
        <h2 className="font-headline-lg text-on-surface mb-md">You've completed all sessions this week!</h2>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-lg px-8 py-3 bg-primary text-on-primary font-label-lg rounded-full hover:bg-primary/90 transition-colors"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  // Section resolution moved to the top of component to avoid Temporal Dead Zone (TDZ) reference errors in Hooks.

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCheckPractice = async () => {
    if (!activeSection || !lesson || isCheckingPractice || practiceFeedback?.isCorrect) return;
    setIsCheckingPractice(true);
    try {
      const submittedVal = Number(practiceAnswer);
      const isCorrect = submittedVal === Number(activeSection.correctAnswer);

      const nextAttempts = practiceAttempts + 1;
      setPracticeAttempts(nextAttempts);

      if (isCorrect) {
        setPracticeFeedback({
          isCorrect: true,
          message: 'Excellent job! Correct answer. 🎉'
        });
      } else {
        setPracticeFeedback({
          isCorrect: false,
          message: 'That is not correct. Try again! You can do it! 💪'
        });
      }

      const timeTaken = Math.round((Date.now() - sectionStartTimeRef.current) / 1000);

      // Call Supabase API to log practice response
      await recordPracticeResponse(
        lesson.sessionId,
        activeSection.id,
        isCorrect,
        nextAttempts,
        timeTaken
      );
    } catch (err) {
      console.error(err);
    } finally {
      setIsCheckingPractice(false);
    }
  };

  const handleNextPart = async () => {
    if (isPracticeLocked) return;
    await flushTime();
    if (currentChunkIndex < orderIndices.length - 1) {
      setCurrentChunkIndex(prev => prev + 1);
    }
  };

  const handleMarkDone = async () => {
    if (isPracticeLocked || isMarkingDone) return;
    setIsMarkingDone(true);
    try {
      await markDone();
      navigate('/dashboard');
    } catch (err) {
      console.error(err);
      setIsMarkingDone(false);
    }
  };

  const handleExplainDifferently = () => {
    const newStyle = explanationStyle === 'text' ? 'analogy' : 'text';
    setExplanationStyle(newStyle);
    setGenCount(prev => prev + 1);
  };

  const handlePlayVoice = () => {
    if (activeSection) {
      const textToSpeak = activeSection.sectionType === 'explanation' && dynamicExplanation
        ? dynamicExplanation
        : activeSection.content;
      speak(textToSpeak);
    }
  };

  const handleAskAgent = async () => {
    if (!studentQuery.trim() || !activeSection || !lesson || isAnswering) return;
    setIsAnswering(true);
    try {
      const ans = await askMathAgent(
        activeSection.id,
        lesson.topicId,
        lesson.chapterId || '00000000-0000-0000-0000-000000000000',
        studentQuery,
        profile?.grade_level || 2
      );
      setAgentAnswer(ans);
    } catch (err) {
      console.error(err);
      setAgentAnswer("Sorry, I had an error answering that. Please try again!");
    } finally {
      setIsAnswering(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)]">
      <div className="w-full max-w-container-max flex flex-col items-center">

        {/* Voice/Text Toggle */}
        <div className="flex items-center bg-surface-container-low rounded-full p-1 mb-xl border border-outline-variant/30">
          <button
            onClick={() => { toggleVoiceMode(); if (!voiceMode) handlePlayVoice(); }}
            className={`flex items-center gap-2 px-6 py-2 rounded-full font-label-lg transition-all ${voiceMode ? 'bg-surface shadow-sm text-primary' : 'text-on-surface-variant hover:text-primary'}`}
          >
            <Mic size={20} />
            Listen
          </button>
          <button
            onClick={() => { if (voiceMode) toggleVoiceMode(); }}
            className={`flex items-center gap-2 px-6 py-2 rounded-full font-label-lg transition-all ${!voiceMode ? 'bg-surface shadow-sm text-primary' : 'text-on-surface-variant hover:text-primary'}`}
          >
            <FileText size={20} />
            Read
          </button>
        </div>

        {/* Segmented Progress Bar */}
        <div aria-label="Lesson Progress" className="w-full max-w-md flex gap-2 mb-xl">
          {orderIndices.map((order, index) => (
            <div key={order as number} className="h-2 flex-1 rounded-full relative overflow-hidden bg-surface-variant">
              {index < currentChunkIndex && (
                <div className="absolute inset-0 bg-primary rounded-full" />
              )}
              {index === currentChunkIndex && (
                <div className="absolute inset-y-0 left-0 bg-primary w-1/2 rounded-full" />
              )}
            </div>
          ))}
        </div>

        {/* Main Teaching Card */}
        <div className={`bg-surface rounded-xl p-xxl shadow-[0_4px_24px_rgba(67,97,130,0.08)] border border-surface-variant/50 w-full mb-xl transition-all duration-300 ${reduceMotion ? '' : 'hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(67,97,130,0.12)]'}`}>
          <h2 className="font-headline-lg text-headline-lg text-on-surface text-center mb-lg font-bold">
            {lesson.topicName}
          </h2>
          <p className="font-body-lg text-body-lg text-on-surface-variant text-center max-w-2xl mx-auto leading-relaxed whitespace-pre-wrap">
            {activeSection?.sectionType === 'explanation' ? (
              isGenerating ? (
                <span className="flex items-center justify-center gap-2 text-primary font-bold animate-pulse">
                  <Lightbulb className="animate-bounce" />
                  Generating custom explanation...
                </span>
              ) : (
                dynamicExplanation || activeSection.content
              )
            ) : (
              activeSection?.content
            )}
          </p>

          {/* Q&A RAG Section */}
          {activeSection?.sectionType === 'explanation' && (
            <div className="mt-xl border-t border-outline-variant/30 pt-lg text-left max-w-xl mx-auto w-full animate-fade-in">
              <h3 className="font-label-lg text-primary mb-md flex items-center gap-2 font-bold">
                <Lightbulb size={20} />
                Ask the Math Agent
              </h3>
              <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-md flex flex-col gap-md">
                <p className="font-body-sm text-on-surface-variant leading-relaxed">
                  Have a question about this part of the lesson? Ask below and the Math Agent will explain!
                </p>
                
                <div className="flex gap-sm">
                  <input
                    type="text"
                    value={studentQuery}
                    onChange={(e) => setStudentQuery(e.target.value)}
                    placeholder="e.g., Why do we carry the ten?"
                    className="flex-1 p-md rounded-xl bg-surface border border-outline-variant text-on-surface font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAskAgent();
                    }}
                  />
                  <button
                    onClick={handleAskAgent}
                    disabled={isAnswering || !studentQuery.trim()}
                    className="px-6 py-2 bg-primary text-on-primary font-bold rounded-xl hover:bg-primary/95 transition-all disabled:opacity-50"
                  >
                    {isAnswering ? 'Thinking...' : 'Ask'}
                  </button>
                </div>

                {agentAnswer && (
                  <div className="mt-sm p-md rounded-xl bg-surface border border-outline-variant/30 text-on-surface font-body-md animate-fade-in whitespace-pre-wrap">
                    <strong className="text-primary block mb-xs">Math Agent:</strong>
                    {agentAnswer}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Interactive Practice Question */}
          {activeSection?.sectionType === 'practice' && activeSection?.questionPrompt && (
            <div className="mt-xl border-t border-outline-variant/30 pt-lg text-left max-w-xl mx-auto w-full animate-fade-in">
              <h3 className="font-label-lg text-primary mb-md block">Practice Problem:</h3>
              <div className="bg-surface-container-low border border-outline-variant/20 rounded-xl p-md flex flex-col gap-md animate-fade-in">
                <p className="font-body-md text-on-surface font-bold leading-relaxed">
                  {activeSection.questionPrompt}
                </p>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-sm">
                  <input
                    type="number"
                    value={practiceAnswer}
                    disabled={practiceFeedback?.isCorrect}
                    onChange={(e) => setPracticeAnswer(e.target.value)}
                    placeholder="Type your answer"
                    className="flex-1 p-md rounded-xl bg-surface border border-outline-variant text-on-surface font-bold focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <button
                    onClick={handleCheckPractice}
                    disabled={practiceFeedback?.isCorrect || !practiceAnswer.trim()}
                    className={`px-6 py-3 rounded-full font-label-lg font-bold transition-all
                      ${practiceFeedback?.isCorrect
                        ? 'bg-secondary-container text-primary border border-primary/20'
                        : 'bg-primary text-on-primary hover:bg-primary/90'
                      }
                    `}
                  >
                    {practiceFeedback?.isCorrect ? '✓ Correct' : 'Submit Answer'}
                  </button>
                </div>

                {/* Feedback Message */}
                {practiceFeedback && (
                  <div
                    className={`p-md rounded-xl border flex items-center gap-2 font-label-md transition-all duration-300
                      ${practiceFeedback.isCorrect
                        ? 'bg-secondary-container/50 border-primary/20 text-primary'
                        : 'bg-error-container/50 border-error/20 text-error'
                      }
                    `}
                  >
                    <span>{practiceFeedback.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Micro-state check-in (interaction sections only) */}
          {activeSection?.sectionType === 'interaction' && (
            <div className="mt-xl text-center">
              <span className="text-on-surface-variant font-label-sm mr-2">Still with me?</span>
              <button className="text-primary font-label-sm hover:underline underline-offset-4 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded px-1">
                Yes, keep going
              </button>
            </div>
          )}
        </div>

        {/* Action Area */}
        <div className="flex flex-col items-center gap-md w-full max-w-md">

          {/* Primary Action — "Next" for middle sections, "Mark as Done" on last */}
          {isLastSection ? (
            <button
              id="btn-mark-done"
              onClick={handleMarkDone}
              disabled={isPracticeLocked}
              className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={20} />
              Mark as Done
            </button>
          ) : (
            <button
              id="btn-next-section"
              onClick={handleNextPart}
              disabled={isPracticeLocked}
              className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full flex items-center justify-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              I'm ready for the next part
              <ArrowRight size={20} />
            </button>
          )}

          {/* Secondary Actions (explanation sections only) */}
          {activeSection?.sectionType === 'explanation' && (
            <div className="flex w-full gap-md mt-sm">
              <button
                onClick={handleExplainDifferently}
                className="flex-1 min-h-[48px] border-2 border-outline-variant text-primary font-label-lg rounded-full hover:bg-primary/5 hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                Explain it differently
              </button>
              <button className="flex-1 min-h-[48px] border-2 border-outline-variant text-primary font-label-lg rounded-full hover:bg-primary/5 hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 flex items-center justify-center gap-2">
                <Lightbulb size={20} />
                Give me an example
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
