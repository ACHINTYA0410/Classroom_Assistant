import React from 'react';
import { Flame, Mic, Coffee, Play } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { useSession } from '../context/SessionContext';

interface TopNavProps {
  streakDays?: number;
  studentName?: string;
}

export const TopNav = ({ streakDays = 0, studentName = 'Student' }: TopNavProps) => {
  const { voiceMode, toggleVoiceMode } = useSettings();
  const { sessionProgressId, isOnBreak, takeBreak, resumeFromBreak } = useSession();

  const sessionActive = !!sessionProgressId;

  const handleBreakResume = async () => {
    if (!sessionActive) return;
    if (isOnBreak) {
      await resumeFromBreak();
    } else {
      await takeBreak();
    }
  };

  return (
    <header className="fixed top-0 right-0 left-0 md:left-[260px] h-16 z-40 bg-surface/80 backdrop-blur-md flex justify-between items-center px-lg border-b border-outline-variant/20">
      <div className="flex items-center">
        <span className="font-headline-md text-headline-md font-bold text-primary block md:hidden">Inclusive Classroom</span>
      </div>
      <div className="flex items-center gap-4 ml-auto">

        {/* Streak counter */}
        <button className="flex items-center gap-2 px-4 py-2 rounded-full bg-surface-container-high hover:bg-surface-variant transition-colors group">
          <Flame className="text-tertiary-fixed-dim" size={20} />
          <span className="font-label-sm text-label-sm font-bold text-on-surface">{streakDays}</span>
        </button>

        {/* Voice toggle */}
        <button
          onClick={toggleVoiceMode}
          className={`p-2 rounded-full hover:bg-surface-container transition-colors ${voiceMode ? 'text-primary' : 'text-on-surface-variant'}`}
          title="Toggle Voice Mode"
        >
          <Mic size={20} />
        </button>

        {/* Break / Resume button — active only during a lesson session */}
        <button
          id="btn-break-resume"
          onClick={handleBreakResume}
          disabled={!sessionActive}
          title={!sessionActive ? 'No active session' : isOnBreak ? 'Resume session' : 'Take a break'}
          className={`flex items-center gap-2 font-label-lg px-4 py-2 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2
            ${!sessionActive
              ? 'text-on-surface-variant/40 cursor-not-allowed'
              : isOnBreak
                ? 'bg-primary text-on-primary hover:bg-primary/90 focus:ring-primary'
                : 'text-tertiary font-bold hover:bg-tertiary/10 focus:ring-tertiary'
            }`}
        >
          {isOnBreak ? <><Play size={16} /> Resume</> : <><Coffee size={16} /> Break Mode</>}
        </button>

        {/* Student avatar */}
        <div className="flex items-center gap-3 pl-4 border-l border-outline-variant">
          <span className="font-label-lg text-label-lg text-on-surface hidden sm:block">{studentName}</span>
          <div className="w-10 h-10 rounded-full border-2 border-surface bg-secondary flex items-center justify-center text-on-secondary font-bold">
            {studentName.charAt(0)}
          </div>
        </div>
      </div>
    </header>
  );
};
