import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getNextLesson,
  getWeeklyProgress,
  markSessionCompletedDirectly,
  resetSessionProgressDirectly,
  getRecommendation,
} from '../services/api';
import { BookOpen, ArrowRight, Lock, HelpCircle, Sparkles } from 'lucide-react';

type SessionStatus = 'not_started' | 'in_progress' | 'completed';

interface WeekDay {
  sessionId: string;
  dayNumber: number;
  title: string;
  sessionType: string;
  status: SessionStatus;
  orderIndex: number;
}

export const StudentDashboard = () => {
  const navigate = useNavigate();
  const [nextLesson, setNextLesson] = useState<any>(null);
  const [weekDays, setWeekDays] = useState<WeekDay[]>([]);
  const [recommendation, setRecommendation] = useState<any>(null);

  const fetchDashboardData = async () => {
    try {
      const lesson = await getNextLesson();
      setNextLesson(lesson);
      const progress = await getWeeklyProgress();
      setWeekDays(progress);
      const rec = await getRecommendation();
      setRecommendation(rec);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const completedCount = weekDays.filter(d => d.status === 'completed').length;
  const totalCount = weekDays.length;

  const firstIncomplete = weekDays.find(d => d.status !== 'completed');

  const handleMarkDone = async (sessionId: string) => {
    await markSessionCompletedDirectly(sessionId);
    fetchDashboardData();
  };

  const handleUndo = async (sessionId: string) => {
    await resetSessionProgressDirectly(sessionId);
    fetchDashboardData();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-xl">
      <div className="lg:col-span-2 flex flex-col gap-xl">

        {/* ── Continue Learning Hero Card ─────────────────────────────────── */}
        <div className="bg-surface-container-lowest rounded-2xl p-8 shadow-[0_4px_24px_rgba(67,97,130,0.04)] hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(67,97,130,0.08)] transition-all duration-300 border border-outline-variant/30 flex flex-col">
          <div className="flex items-start justify-between mb-6">
            <div>
              <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider mb-2 block">
                {nextLesson?.allDone ? 'Week Complete!' : 'Continue Learning'}
              </span>
              <h2 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                {nextLesson?.topicName ?? 'Math: Adding 2-digit numbers'}
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                {nextLesson?.allDone
                  ? 'You finished all lessons this week 🎉'
                  : `Session ${completedCount + 1} of ${totalCount}`}
              </p>
            </div>
            <div className="bg-primary/10 p-4 rounded-full">
              <BookOpen className="text-primary" size={36} />
            </div>
          </div>
          <div className="mt-auto pt-4">
            {/* Mini progress bar */}
            <div className="flex items-center justify-between mb-2">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Week Progress</span>
              <span className="font-label-sm text-label-sm text-primary font-bold">
                {completedCount} of {totalCount} sessions
              </span>
            </div>
            <div className="flex gap-1.5 w-full h-2 mb-6">
              {weekDays.map(day => (
                <div
                  key={day.sessionId}
                  className={`flex-1 rounded-full transition-colors ${
                    day.status === 'completed' ? 'bg-primary' :
                    day.status === 'in_progress' ? 'bg-primary/40' :
                    'bg-surface-container-highest'
                  }`}
                />
              ))}
            </div>
            {!nextLesson?.allDone && (
              <button
                id="btn-resume-lesson"
                onClick={() => navigate('/lessons')}
                className="w-full sm:w-auto min-h-[48px] px-8 rounded-full bg-primary text-on-primary font-label-lg hover:bg-primary-container hover:text-on-primary-container hover:scale-105 hover:shadow-lg transition-all duration-200 flex items-center justify-center gap-2"
              >
                {completedCount === 0 ? 'Start Lesson' : 'Resume Lesson'}
                <ArrowRight size={20} />
              </button>
            )}
          </div>
        </div>

        {/* ── Personalized Extra Practice Recommendations ──────────────────────── */}
        {recommendation && recommendation.weakTopics && recommendation.weakTopics.length > 0 && (
          <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_4px_24px_rgba(67,97,130,0.04)] border-2 border-secondary/20 hover:shadow-[0_8px_32px_rgba(67,97,130,0.08)] transition-all duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-secondary/15 p-2.5 rounded-xl text-secondary">
                <Sparkles size={22} className="animate-pulse" />
              </div>
              <div>
                <h3 className="font-headline-md text-headline-md text-on-surface">Recommended Practice</h3>
                <p className="font-body-sm text-on-surface-variant">Let's do some extra practice to strengthen your skills!</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
              {recommendation.weakTopics.map((topic: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => topic.sessionId && navigate('/lessons', { state: { sessionId: topic.sessionId } })}
                  className={`p-md rounded-xl border border-outline-variant/50 bg-surface hover:bg-secondary/5 hover:border-secondary hover:-translate-y-0.5 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-sm ${!topic.sessionId ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <div>
                    <span className="inline-block px-2.5 py-0.5 bg-secondary/10 text-secondary text-[11px] font-bold rounded-full mb-2 uppercase tracking-wide">
                      Extra Practice
                    </span>
                    <h4 className="font-label-lg text-on-surface font-bold">
                      {topic.topicName}
                    </h4>
                    {topic.primaryMisconceptionTag && (
                      <p className="font-body-xs text-error/80 mt-1 flex items-start gap-1">
                        <span className="font-bold">Focus area:</span>
                        <span>{topic.primaryMisconceptionTag.replace(/_/g, ' ')}</span>
                      </p>
                    )}
                  </div>
                  {topic.sessionId && (
                    <div className="flex items-center gap-1 text-secondary text-xs font-bold mt-2 self-end">
                      <span>Practice Now</span>
                      <ArrowRight size={14} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Weekly Interactive Calendar ─────────────────────────────────── */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_4px_24px_rgba(67,97,130,0.04)] border border-outline-variant/30">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-headline-md text-headline-md text-on-surface">Weekly Curriculum & Progress</h3>
            <span className="font-label-sm text-primary bg-primary/10 px-3 py-1 rounded-full">
              {completedCount}/{totalCount} done
            </span>
          </div>

          {weekDays.length === 0 ? (
            <div className="flex flex-col gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-surface-variant animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {weekDays.map((day) => {
                const isRevision = day.sessionType === 'revision';
                const label = isRevision ? 'Revision Session' : `Day ${day.dayNumber}`;
                const isFirstIncomplete = firstIncomplete?.sessionId === day.sessionId;

                return (
                  <div
                    key={day.sessionId}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between p-md rounded-xl border-2 transition-all gap-md
                      ${day.status === 'completed'
                        ? 'border-primary/20 bg-primary/5'
                        : day.status === 'in_progress'
                          ? 'border-secondary/20 bg-secondary/5'
                          : 'border-outline-variant/30 bg-surface'
                      }
                    `}
                  >
                    <div className="flex items-center gap-md">
                      {/* Status indicator */}
                      <div className="shrink-0 flex items-center justify-center w-6 h-6">
                        {day.status === 'completed' ? (
                          <div className="w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-sm">✓</div>
                        ) : day.status === 'in_progress' ? (
                          <div className="w-6 h-6 rounded-full border-2 border-primary text-primary flex items-center justify-center font-bold text-sm">●</div>
                        ) : (
                          <div className="w-6 h-6 rounded-full border-2 border-outline-variant" />
                        )}
                      </div>

                      {/* Info text */}
                      <div>
                        <span className="font-label-sm text-on-surface-variant text-xs uppercase tracking-wider block">
                          {label}
                        </span>
                        <h4 className="font-label-lg text-on-surface leading-snug">
                          {day.title}
                        </h4>
                      </div>
                    </div>

                    {/* Interactive controls */}
                    <div className="flex items-center gap-sm self-end sm:self-auto">
                      <button
                        onClick={() => navigate('/lessons', { state: { sessionId: day.sessionId } })}
                        className="px-4 py-1.5 rounded-full border border-primary text-primary hover:bg-primary/5 font-label-sm text-xs transition-colors font-bold"
                      >
                        Attend
                      </button>

                      {day.status === 'completed' ? (
                        <button
                          onClick={() => handleUndo(day.sessionId)}
                          className="px-4 py-1.5 rounded-full bg-error/10 text-error hover:bg-error/20 font-label-sm text-xs transition-colors font-bold"
                        >
                          Undo
                        </button>
                      ) : (
                        isFirstIncomplete && (
                          <button
                            onClick={() => handleMarkDone(day.sessionId)}
                            className="px-4 py-1.5 rounded-full bg-primary text-on-primary hover:bg-primary/95 font-label-sm text-xs transition-colors font-bold"
                          >
                            Mark Done
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Weekly Quiz slot */}
              <div
                className={`flex flex-col sm:flex-row sm:items-center justify-between p-md rounded-xl border-2 gap-md
                  ${completedCount === totalCount
                    ? 'border-primary/20 bg-primary/5'
                    : 'border-outline-variant/30 bg-surface-variant/40 opacity-70'
                  }
                `}
              >
                <div className="flex items-center gap-md">
                  <div className="shrink-0 flex items-center justify-center w-6 h-6">
                    {completedCount === totalCount ? (
                      <HelpCircle className="text-primary" size={20} />
                    ) : (
                      <Lock className="text-on-surface-variant/40" size={18} />
                    )}
                  </div>
                  <div>
                    <span className="font-label-sm text-on-surface-variant text-xs uppercase tracking-wider block">
                      Weekly Assessment
                    </span>
                    <h4 className="font-label-lg text-on-surface leading-snug">
                      Week 1 Quiz: Addition with Regrouping
                    </h4>
                  </div>
                </div>

                <div className="flex items-center gap-sm self-end sm:self-auto">
                  {completedCount === totalCount ? (
                    <button
                      onClick={() => navigate('/quiz')}
                      className="px-6 py-2 rounded-full bg-primary text-on-primary hover:bg-primary/90 font-label-sm text-sm transition-colors font-bold shadow-md"
                    >
                      Take Quiz
                    </button>
                  ) : (
                    <span className="text-xs text-on-surface-variant/60 italic font-body-sm mr-2 flex items-center gap-1">
                      <Lock size={12} /> Locked
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-xl">

        {/* Today's Goal */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30 text-center">
          <h3 className="font-label-lg text-label-lg text-on-surface mb-4">Today's Goal</h3>
          <div className="relative w-28 h-28 mx-auto mb-3">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle className="text-surface-dim" cx="50" cy="50" fill="transparent" r="40" stroke="currentColor" strokeWidth="8" />
              <circle
                className="text-primary transition-all duration-500"
                cx="50" cy="50" fill="transparent" r="40"
                stroke="currentColor"
                strokeDasharray="251.2"
                strokeDashoffset={251.2 - (251.2 * Math.min(completedCount / Math.max(totalCount, 1), 1))}
                strokeLinecap="round"
                strokeWidth="8"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-headline-md font-bold text-on-surface">
                {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
              </span>
            </div>
          </div>
          <p className="font-body-sm text-on-surface-variant">
            {completedCount < totalCount
              ? `${totalCount - completedCount} session${totalCount - completedCount > 1 ? 's' : ''} left this week`
              : 'Week complete! 🎉'}
          </p>
        </div>

        {/* Upcoming — next incomplete session or quiz */}
        <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30 group hover:bg-surface-container-low transition-colors cursor-pointer"
          onClick={() => !nextLesson?.allDone && navigate('/lessons')}>
          <div className="flex items-center gap-4 mb-3">
            <div className="bg-secondary/10 p-3 rounded-xl text-secondary">
              <BookOpen size={24} />
            </div>
            <div>
              <span className="font-label-sm text-on-surface-variant block mb-1">Up Next</span>
              <h4 className="font-label-lg text-on-surface group-hover:text-primary transition-colors">
                {nextLesson?.allDone
                  ? 'Weekly Quiz'
                  : nextLesson?.topicName ?? '...'}
              </h4>
            </div>
          </div>
          <div className="flex justify-end">
            {nextLesson?.allDone
              ? <ArrowRight className="text-primary" size={20} />
              : <ArrowRight className="text-outline group-hover:text-primary transition-colors" />
            }
          </div>
        </div>

      </div>
    </div>
  );
};
