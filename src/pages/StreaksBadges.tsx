import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { getStreakData } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { Award, ArrowRight } from 'lucide-react';

export const StreaksBadges = () => {
  const navigate = useNavigate();
  const { reduceMotion } = useSettings();
  const [streakDays, setStreakDays] = useState(0);

  useEffect(() => {
    getStreakData().then(data => setStreakDays(data.streakDays));
  }, []);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-lg min-h-[calc(100vh-64px)] relative">
      {/* Confetti — skipped when reduce motion is on */}
      {!reduceMotion && (
        <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center">
          <div className="w-full h-full max-w-lg relative flex items-center justify-center">
            <DotLottieReact
              src="https://lottie.host/80bb731a-e9dd-48d0-ba07-dc3a365bb54f/K2X7F1Yj5L.lottie"
              autoplay
              loop={false}
              className="w-full h-full opacity-60"
            />
          </div>
        </div>
      )}
      
      <div className="z-10 bg-surface-container-lowest rounded-3xl p-xxl shadow-[0_8px_32px_rgba(126,82,0,0.12)] border border-tertiary-fixed-dim/30 text-center max-w-md w-full animate-fade-in-up">
        
        <div className="bg-tertiary-container text-tertiary w-24 h-24 rounded-full mx-auto flex items-center justify-center mb-xl shadow-inner">
          <Award size={48} />
        </div>

        <h1 className="font-display-lg text-display-lg text-on-surface mb-md">
          {streakDays} Day Streak!
        </h1>
        
        <p className="font-body-lg text-on-surface-variant mb-xl">
          You completed the "Adding 2-digit numbers" quiz and kept your streak alive. Fantastic work!
        </p>

        <div className="flex flex-col gap-md">
          <button 
            onClick={() => navigate('/progress')}
            className="w-full min-h-[56px] bg-tertiary text-on-tertiary font-label-lg rounded-full flex items-center justify-center gap-2 hover:bg-tertiary-container hover:text-on-tertiary-container transition-colors shadow-md focus:outline-none focus:ring-2 focus:ring-tertiary focus:ring-offset-2"
          >
            View Progress Profile
            <ArrowRight size={20} />
          </button>
          
          <button 
            onClick={() => navigate('/dashboard')}
            className="w-full min-h-[56px] border-2 border-outline-variant text-tertiary font-label-lg rounded-full flex items-center justify-center gap-2 hover:bg-tertiary/5 transition-colors focus:outline-none focus:ring-2 focus:ring-tertiary focus:ring-offset-2"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};
