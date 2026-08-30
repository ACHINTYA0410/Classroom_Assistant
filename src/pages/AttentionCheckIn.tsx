import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';
import { getRandomCheckInQuestion } from '../services/api';
import { useSettings } from '../context/SettingsContext';
import { Send, Brain } from 'lucide-react';

export const AttentionCheckIn = () => {
  const navigate = useNavigate();
  const { reduceMotion } = useSettings();
  const [checkIn, setCheckIn] = useState<any>(null);
  const [answer, setAnswer] = useState('');

  useEffect(() => {
    getRandomCheckInQuestion().then(setCheckIn);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (answer.trim()) {
      // In a real app we'd save the answer to a backend or state
      navigate(-1); // Go back to lesson
    }
  };

  if (!checkIn) {
    return <div className="flex-1 flex items-center justify-center">Loading check-in...</div>;
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[calc(100vh-64px)] relative overflow-hidden bg-background">
      
      {/* Background — animated Lottie or static icon based on reduceMotion */}
      <div className="absolute inset-0 z-0 opacity-30 flex items-center justify-center overflow-hidden">
        <div className="w-full h-full max-w-4xl scale-150 flex items-center justify-center">
          {reduceMotion ? (
            <Brain size={200} className="text-primary/20" />
          ) : (
            <DotLottieReact
              src={checkIn.animationUrl}
              loop
              autoplay
            />
          )}
        </div>
      </div>
      
      <div className="z-10 bg-surface/90 backdrop-blur-md rounded-2xl p-xxl shadow-[0_8px_32px_rgba(67,97,130,0.12)] border border-outline-variant/30 text-center max-w-xl w-full">
        <div className="flex flex-col items-center gap-xl animate-fade-in-up">
          <div>
            <span className="font-label-sm text-primary uppercase tracking-wider mb-2 block">Quick Check-in</span>
            <h2 className="font-display-sm text-[28px] leading-tight text-on-surface mb-2">
              {checkIn.question}
            </h2>
          </div>
          
          <form onSubmit={handleSubmit} className="flex flex-col w-full gap-lg">
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type your answer here..."
              className="w-full min-h-[120px] p-md rounded-xl bg-surface-container-lowest border border-outline-variant focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-body-md text-on-surface resize-none"
              autoFocus
            />
            
            <button 
              type="submit"
              disabled={!answer.trim()}
              className="w-full min-h-[56px] bg-primary text-on-primary font-label-lg rounded-full flex items-center justify-center gap-2 hover:bg-primary-container transition-all disabled:opacity-50 disabled:hover:bg-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <Send size={20} />
              Submit and Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
