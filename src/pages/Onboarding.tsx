import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';

type Step = 'grade' | 'style';

const grades = [2, 3, 4, 5];
const styles = [
  { value: 'text' as const, label: 'Text Step-by-Step', description: 'Clear written explanations, one step at a time.' },
  { value: 'analogy' as const, label: 'Real-world Analogy', description: 'Concepts explained through everyday examples.' },
];

export const Onboarding = () => {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState<Step>('grade');
  const [selectedGrade, setSelectedGrade] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectGrade = async (grade: number) => {
    setSelectedGrade(grade);
    setError(null);

    if (user) {
      setLoading(true);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ grade_level: grade })
        .eq('id', user.id);
      setLoading(false);

      if (updateError) {
        setError('Could not save grade. Please try again.');
        return;
      }
    }

    // Proceed to style selection
    setStep('style');
  };

  const handleSelectStyle = async (style: 'text' | 'analogy') => {
    setError(null);

    if (user) {
      setLoading(true);
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          preferred_explanation_style: style,
          onboarding_completed: true,
        })
        .eq('id', user.id);
      setLoading(false);

      if (updateError) {
        setError('Could not save preferences. Please try again.');
        return;
      }

      // Refresh the profile in context so ProtectedRoute sees onboarding_completed = true
      await refreshProfile();
    }

    navigate('/dashboard', { replace: true });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-lg min-h-screen bg-background text-on-background">
      <div className="w-full max-w-2xl flex flex-col items-center gap-xl animate-fade-in-up">

        {/* Icon */}
        <div className="w-24 h-24 rounded-full bg-surface-container flex items-center justify-center text-primary mb-md shadow-sm">
          <BookOpen size={48} />
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full transition-colors ${step === 'grade' ? 'bg-primary' : 'bg-primary/30'}`} />
          <div className={`w-2.5 h-2.5 rounded-full transition-colors ${step === 'style' ? 'bg-primary' : 'bg-outline-variant'}`} />
        </div>

        {/* Grade step */}
        {step === 'grade' && (
          <>
            <div className="text-center">
              <h1 className="font-display-lg text-display-lg text-on-surface mb-2">Welcome to Inclusive Assistant</h1>
              <p className="font-body-lg text-on-surface-variant">Let's set up your safe learning space. What grade are you in?</p>
            </div>

            {error && (
              <p className="text-error font-body-sm bg-error/10 border border-error/30 rounded-xl px-4 py-2">{error}</p>
            )}

            <div className="grid grid-cols-2 gap-md w-full max-w-md">
              {grades.map((grade) => (
                <button
                  key={grade}
                  id={`btn-grade-${grade}`}
                  onClick={() => handleSelectGrade(grade)}
                  disabled={loading}
                  className="py-6 px-4 bg-surface-container-lowest rounded-2xl shadow-[0_4px_24px_rgba(67,97,130,0.04)] border border-outline-variant/30 font-headline-lg text-primary hover:bg-primary/5 hover:border-primary hover:-translate-y-1 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading && selectedGrade === grade
                    ? <Loader2 size={20} className="animate-spin mx-auto" />
                    : `Grade ${grade}`
                  }
                </button>
              ))}
            </div>
          </>
        )}

        {/* Style step */}
        {step === 'style' && (
          <>
            <div className="text-center">
              <h1 className="font-display-lg text-display-lg text-on-surface mb-2">How do you learn best?</h1>
              <p className="font-body-lg text-on-surface-variant">Choose how you'd like concepts explained to you.</p>
            </div>

            {error && (
              <p className="text-error font-body-sm bg-error/10 border border-error/30 rounded-xl px-4 py-2">{error}</p>
            )}

            <div className="flex flex-col gap-md w-full max-w-md">
              {styles.map((s) => (
                <button
                  key={s.value}
                  id={`btn-style-${s.value}`}
                  onClick={() => handleSelectStyle(s.value)}
                  disabled={loading}
                  className="py-6 px-6 bg-surface-container-lowest rounded-2xl shadow-[0_4px_24px_rgba(67,97,130,0.04)] border border-outline-variant/30 text-left hover:bg-primary/5 hover:border-primary hover:-translate-y-1 transition-all focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <Loader2 size={20} className="animate-spin text-primary" />
                  ) : (
                    <>
                      <p className="font-headline-md text-primary mb-1">{s.label}</p>
                      <p className="font-body-sm text-on-surface-variant">{s.description}</p>
                    </>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

      </div>
    </div>
  );
};
