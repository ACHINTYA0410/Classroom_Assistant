import React, { useEffect, useState } from 'react';
import { getLearnerProfile } from '../services/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

export const ProgressProfile = () => {
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    getLearnerProfile().then(setProfile);
  }, []);

  if (!profile) return <div className="p-xl text-center">Loading profile...</div>;

  const weakConcepts = profile.weakConcepts || [];
  const masteredConcepts = profile.masteredConcepts || [];

  return (
    <div className="flex flex-col gap-xl">
      {/* Accuracy Chart */}
      <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
        <div className="flex items-center gap-4 mb-lg">
          <div className="bg-primary/10 p-4 rounded-full text-primary">
            <TrendingUp size={32} />
          </div>
          <div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface">Accuracy Over Time</h2>
            <p className="font-body-md text-on-surface-variant">Your recent quiz scores</p>
          </div>
        </div>
        
        <div className="w-full h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={profile.quizHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e3e4" vertical={false} />
              <XAxis dataKey="date" stroke="#6f797c" fontSize={14} tickLine={false} axisLine={false} />
              <YAxis stroke="#6f797c" fontSize={14} tickLine={false} axisLine={false} domain={[0, 100]} />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
              />
              <Line 
                type="monotone" 
                dataKey="score" 
                stroke="#006474" 
                strokeWidth={4} 
                dot={{ r: 6, fill: '#006474', strokeWidth: 0 }} 
                activeDot={{ r: 8 }} 
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Mastery Status grids */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-lg">
        
        {/* Mastered Concepts */}
        <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-md">Mastered Concepts</h3>
          <div className="flex flex-col gap-sm">
            {masteredConcepts.length > 0 ? (
              masteredConcepts.map((concept: any, index: number) => (
                <div key={index} className="flex items-center gap-4 p-md bg-secondary-container/20 rounded-xl border border-primary/20">
                  <CheckCircle2 className="text-primary" size={24} />
                  <div>
                    <h4 className="font-label-lg text-on-surface">{concept.topicName}</h4>
                    <p className="font-body-sm text-on-surface-variant">Exceptional performance!</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm font-body-sm text-on-surface-variant italic p-md">
                Keep learning and scoring high to master topics!
              </p>
            )}
          </div>
        </div>

        {/* Areas to Review */}
        <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-md">Areas to Review</h3>
          <div className="flex flex-col gap-sm">
            {weakConcepts.length > 0 ? (
              weakConcepts.map((concept: any, index: number) => (
                <div key={index} className="flex items-center gap-4 p-md bg-error-container/20 rounded-xl border border-error/20">
                  <AlertTriangle className="text-error" size={24} />
                  <div>
                    <h4 className="font-label-lg text-on-surface">{concept.topicName}</h4>
                    <p className="font-body-sm text-on-surface-variant capitalize">
                      Issue: {concept.primaryMisconceptionTag.replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm font-body-sm text-on-surface-variant italic p-md">
                Awesome! You have no weak concepts flagged.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
