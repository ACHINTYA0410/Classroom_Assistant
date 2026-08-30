import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getEducatorSummary } from '../services/api';
import { Users, AlertTriangle, CheckCircle } from 'lucide-react';

export const EducatorDashboard = () => {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    getEducatorSummary().then(setSummary);
  }, []);

  if (!summary) return <div className="p-xl text-center">Loading educator view...</div>;

  return (
    <div className="flex flex-col gap-xl">
      <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30 flex flex-col md:flex-row items-center justify-between gap-lg">
        <div className="flex items-center gap-md">
          <div className="bg-primary/10 p-4 rounded-full text-primary">
            <Users size={32} />
          </div>
          <div>
            <h2 className="font-headline-lg text-headline-lg text-on-surface">Student: {summary.name}</h2>
            <p className="font-body-md text-on-surface-variant">Current Streak: {summary.streakDays} Days</p>
          </div>
        </div>
        <button
          onClick={() => navigate('/educator/audit')}
          className="w-full md:w-auto min-h-[44px] px-6 rounded-full bg-primary text-on-primary font-label-md hover:bg-primary/95 transition-all flex items-center justify-center gap-2 cursor-pointer font-bold"
        >
          View Agent Decision Audit
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-xl">
        <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-md flex items-center gap-2">
            <CheckCircle className="text-secondary" />
            Recent Scores
          </h3>
          <ul className="flex flex-col gap-sm">
            {summary.recentScores.map((scoreObj: any, i: number) => (
              <li key={i} className="flex justify-between items-center p-md bg-surface rounded-xl border border-surface-variant">
                <span className="font-label-lg text-on-surface">{scoreObj.topicName}</span>
                <div className="text-right">
                  <span className="font-headline-sm text-primary block">{scoreObj.score}%</span>
                  <span className="font-label-sm text-on-surface-variant">{scoreObj.date}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-surface-container-lowest rounded-2xl p-xl shadow-[0_4px_24px_rgba(67,97,130,0.06)] border border-outline-variant/30">
          <h3 className="font-headline-md text-headline-md text-on-surface mb-md flex items-center gap-2">
            <AlertTriangle className="text-error" />
            Flagged Topics
          </h3>
          <ul className="flex flex-col gap-sm">
            {summary.flaggedTopics.map((topic: any, i: number) => (
              <li key={i} className="flex flex-col gap-1 p-md bg-error-container/20 rounded-xl border border-error/20">
                <span className="font-label-lg text-on-surface">{topic.topicName}</span>
                <span className="font-body-sm text-on-surface-variant">Observed issue: {topic.issue}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
