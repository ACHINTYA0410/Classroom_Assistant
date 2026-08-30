import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { Settings as SettingsIcon, LogOut, Loader2 } from 'lucide-react';

export const Settings = () => {
  const { reduceMotion, toggleReduceMotion, voiceMode, toggleVoiceMode, explanationStyle, setExplanationStyle } = useSettings();
  const { signOut, profile } = useAuth();
  const navigate = useNavigate();
  const [signOutLoading, setSignOutLoading] = useState(false);

  const handleSignOut = async () => {
    setSignOutLoading(true);
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex flex-col gap-xl">
      <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
        <div className="flex items-center gap-4 mb-lg">
          <div className="bg-primary/10 p-4 rounded-full text-primary">
            <SettingsIcon size={32} />
          </div>
          <div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface">Preferences</h2>
            <p className="font-body-md text-on-surface-variant">Customize your learning experience</p>
          </div>
        </div>
        
        <div className="flex flex-col gap-lg mt-xl">
          {/* Motion Toggle */}
          <div className="flex items-center justify-between border-b border-surface-variant pb-md">
            <div>
              <h3 className="font-label-lg text-on-surface">Reduce Motion</h3>
              <p className="font-body-sm text-on-surface-variant">Minimize animations across the app.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={reduceMotion} onChange={toggleReduceMotion} />
              <div className="w-11 h-6 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Voice Default Toggle */}
          <div className="flex items-center justify-between border-b border-surface-variant pb-md">
            <div>
              <h3 className="font-label-lg text-on-surface">Voice Mode Default</h3>
              <p className="font-body-sm text-on-surface-variant">Read text out loud automatically in lessons and quizzes.</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" checked={voiceMode} onChange={toggleVoiceMode} />
              <div className="w-11 h-6 bg-surface-variant rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {/* Explanation Style */}
          <div className="flex flex-col gap-sm">
            <div>
              <h3 className="font-label-lg text-on-surface">Preferred Explanation Style</h3>
              <p className="font-body-sm text-on-surface-variant">How would you like concepts explained to you initially?</p>
            </div>
            <div className="flex gap-4 mt-2">
              <button 
                onClick={() => setExplanationStyle('text')}
                className={`flex-1 py-3 px-4 rounded-xl font-label-lg border-2 transition-colors ${explanationStyle === 'text' ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-outline-variant text-on-surface'}`}
              >
                Text Step-by-Step
              </button>
              <button 
                onClick={() => setExplanationStyle('analogy')}
                className={`flex-1 py-3 px-4 rounded-xl font-label-lg border-2 transition-colors ${explanationStyle === 'analogy' ? 'bg-primary/10 border-primary text-primary' : 'bg-surface border-outline-variant text-on-surface'}`}
              >
                Real-world Analogy
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sign Out */}
      <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-label-lg text-on-surface">Signed in as</h3>
            <p className="font-body-sm text-on-surface-variant mt-0.5">{profile?.email ?? '—'}</p>
          </div>
          <button
            id="btn-sign-out"
            onClick={handleSignOut}
            disabled={signOutLoading}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-error/10 text-error border border-error/30 font-label-lg hover:bg-error/20 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {signOutLoading
              ? <Loader2 size={16} className="animate-spin" />
              : <LogOut size={16} />}
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
};
