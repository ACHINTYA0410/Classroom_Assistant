import React, { createContext, useContext, useState, useEffect } from 'react';

type ExplanationStyle = 'text' | 'visual' | 'analogy';

interface SettingsContextType {
  reduceMotion: boolean;
  toggleReduceMotion: () => void;
  voiceMode: boolean;
  toggleVoiceMode: () => void;
  explanationStyle: ExplanationStyle;
  setExplanationStyle: (style: ExplanationStyle) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const [explanationStyle, setExplanationStyle] = useState<ExplanationStyle>('text');

  // Sync with OS preference initially if possible, but keep simple for now
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mediaQuery.matches);
  }, []);

  const toggleReduceMotion = () => setReduceMotion(prev => !prev);
  const toggleVoiceMode = () => setVoiceMode(prev => !prev);

  return (
    <SettingsContext.Provider value={{
      reduceMotion, toggleReduceMotion,
      voiceMode, toggleVoiceMode,
      explanationStyle, setExplanationStyle
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
