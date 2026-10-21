import React, { createContext, useContext, useState, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabaseClient';

type ExplanationStyle = 'text' | 'visual' | 'analogy';

interface SettingsContextType {
  reduceMotion: boolean;
  toggleReduceMotion: () => void;
  voiceMode: boolean;
  toggleVoiceMode: () => void;
  explanationStyle: ExplanationStyle;
  setExplanationStyle: (style: ExplanationStyle) => void;
  attentionEnabled: boolean;
  toggleAttention: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);
const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (callback: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, user } = useAuth();
  const osReduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => false);
  const [userReduced, setUserReduced] = useState(() => localStorage.getItem('reduceMotion') === 'true');
  const reduceMotion = osReduced || userReduced;
  const [voiceMode, setVoiceMode] = useState(false);
  const [attentionChoice, setAttentionChoice] = useState<{userId:string;enabled:boolean}|null>(null);
  const attentionEnabled = attentionChoice && attentionChoice.userId === user?.id ? attentionChoice.enabled :
    localStorage.getItem(`attention-support:${user?.id || ''}`) !== 'false';
  const toggleAttention = () => {
    const enabled = !attentionEnabled;
    localStorage.setItem(`attention-support:${user?.id || ''}`, String(enabled));
    setAttentionChoice({userId:user?.id || '',enabled});
  };
  const [styleChoice, setStyleChoice] = useState<{ userId: string; style: ExplanationStyle } | null>(null);
  const explanationStyle = styleChoice && styleChoice.userId === user?.id ? styleChoice.style : profile?.preferred_explanation_style || 'text';
  const setExplanationStyle = (style: ExplanationStyle) => {
    setStyleChoice({ userId: user?.id || '', style });
    if (user) void supabase.from('profiles').update({ preferred_explanation_style: style }).eq('id', user.id).then(({ error }) => {
      if (error) console.warn('Could not save explanation preference.');
    });
  };

  // Sync with OS preference initially if possible, but keep simple for now
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduceMotion);
  }, [reduceMotion]);

  const toggleReduceMotion = () => setUserReduced(prev => {
    localStorage.setItem('reduceMotion', String(!prev)); return !prev;
  });
  const toggleVoiceMode = () => setVoiceMode(prev => !prev);

  return (
    <SettingsContext.Provider value={{
      reduceMotion, toggleReduceMotion,
      voiceMode, toggleVoiceMode,
      explanationStyle, setExplanationStyle, attentionEnabled, toggleAttention
    }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};
