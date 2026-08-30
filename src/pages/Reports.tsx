import React, { useEffect, useState } from 'react';
import { getReports } from '../services/api';
import { Calendar, FileText, ChevronRight, TrendingUp, AlertCircle, CheckCircle2, RefreshCw, Download } from 'lucide-react';

export const Reports = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [selectedReport, setSelectedReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchReports = async () => {
    try {
      setLoading(true);
      const data = await getReports();
      setReports(data);
      if (data.length > 0) {
        setSelectedReport(data[0]);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <span className="font-label-lg text-on-surface-variant">Loading reports...</span>
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-xxl bg-surface-container-lowest rounded-2xl border border-outline-variant/30 text-center max-w-xl mx-auto my-xl">
        <div className="bg-primary/10 text-primary p-4 rounded-full mb-lg">
          <FileText size={36} />
        </div>
        <h2 className="font-headline-lg text-on-surface mb-md">No Reports Yet</h2>
        <p className="font-body-lg text-on-surface-variant mb-lg">
          Your learning reports will appear here after you complete your first quiz attempt.
        </p>
      </div>
    );
  }

  const snapshot = selectedReport?.stats_snapshot || {};
  const currentScore = snapshot.current_score ?? 0;
  const previousScore = snapshot.previous_score;
  const scoreDelta = snapshot.score_delta ?? 0;
  const trend = snapshot.trend ?? 'stable';
  const weakTopics = snapshot.weak_topics || [];
  const strongTopics = snapshot.strong_topics || [];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-xl">
      <style>{`
        @media print {
          nav, header, aside, button, .print-hide {
            display: none !important;
          }
          body, html {
            background: white !important;
            color: black !important;
          }
          main {
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
          #printable-sidebar {
            display: none !important;
          }
          #printable-report-container {
            width: 100% !important;
            max-width: 100% !important;
            flex: 0 0 100% !important;
          }
          #printable-report {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
          }
        }
      `}</style>
      
      {/* Sidebar List of Reports */}
      <div id="printable-sidebar" className="md:col-span-1 print:hidden bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden flex flex-col h-[calc(100vh-180px)]">
        <div className="p-md border-b border-outline-variant/20 flex items-center justify-between">
          <h3 className="font-headline-md text-on-surface">Report History</h3>
          <button 
            onClick={fetchReports}
            className="p-1.5 text-on-surface-variant hover:text-primary rounded-lg hover:bg-surface-container-high transition-colors"
            title="Refresh Reports"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-outline-variant/10">
          {reports.map((report) => {
            const isSelected = selectedReport?.id === report.id;
            const repSnapshot = report.stats_snapshot || {};
            return (
              <button
                key={report.id}
                onClick={() => setSelectedReport(report)}
                className={`w-full p-md text-left transition-all flex items-center justify-between gap-2 border-l-4
                  ${isSelected 
                    ? 'bg-primary/5 border-primary text-primary' 
                    : 'bg-transparent border-transparent text-on-surface hover:bg-surface-container-low'
                  }
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mb-1">
                    <Calendar size={12} />
                    <span>{new Date(report.generated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  </div>
                  <div className="font-label-lg truncate text-on-surface">
                    Assessment Attempt
                  </div>
                </div>
                <div className="font-display-sm font-bold shrink-0">
                  {repSnapshot.current_score}%
                </div>
                <ChevronRight size={16} className="text-on-surface-variant" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Report View */}
      <div id="printable-report-container" className="md:col-span-2 flex flex-col gap-lg">
        {selectedReport && (
          <div id="printable-report" className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-xl shadow-[0_4px_24px_rgba(67,97,130,0.04)]">
            
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-md pb-lg border-b border-outline-variant/20 mb-lg">
              <div>
                <span className="font-label-sm text-primary font-bold uppercase tracking-wider">Report Agent Narrative</span>
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <h2 className="font-headline-lg text-on-surface">Learning Performance Report</h2>
                  <button
                    onClick={() => window.print()}
                    className="p-1.5 px-3 bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-all flex items-center gap-1.5 font-label-sm font-bold print-hide border border-primary/10"
                    title="Download Report as PDF"
                  >
                    <Download size={14} />
                    <span>Download PDF</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5 text-sm text-on-surface-variant mt-1">
                  <Calendar size={14} />
                  <span>Generated on {formatDate(selectedReport.generated_at)}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className="text-xs text-on-surface-variant block">Accuracy Trend</span>
                  <span className={`font-label-lg font-bold capitalize ${trend === 'improving' ? 'text-primary' : trend === 'declining' ? 'text-error' : 'text-on-surface'}`}>
                    {trend}
                  </span>
                </div>
                <div className={`p-2.5 rounded-xl ${trend === 'improving' ? 'bg-primary/10 text-primary' : trend === 'declining' ? 'bg-error/10 text-error' : 'bg-surface-container-high text-on-surface'}`}>
                  <TrendingUp size={24} />
                </div>
              </div>
            </div>

            {/* Score Comparison Display */}
            <div className="bg-surface-container rounded-2xl p-lg grid grid-cols-1 sm:grid-cols-3 gap-md text-center mb-xl border border-outline-variant/10">
              <div className="flex flex-col justify-center py-2">
                <span className="text-xs text-on-surface-variant block mb-1">Previous Score</span>
                <span className="font-display-md text-on-surface font-semibold">
                  {previousScore !== null ? `${previousScore}%` : 'N/A'}
                </span>
              </div>
              <div className="flex flex-col justify-center py-2 border-y sm:border-y-0 sm:border-x border-outline-variant/20">
                <span className="text-xs text-on-surface-variant block mb-1">Current Score</span>
                <span className="font-display-md text-primary font-bold">
                  {currentScore}%
                </span>
              </div>
              <div className="flex flex-col justify-center py-2">
                <span className="text-xs text-on-surface-variant block mb-1">Performance Change</span>
                <span className={`font-display-md font-bold ${scoreDelta > 0 ? 'text-primary' : scoreDelta < 0 ? 'text-error' : 'text-on-surface'}`}>
                  {scoreDelta > 0 ? `+${scoreDelta}%` : scoreDelta < 0 ? `${scoreDelta}%` : '0%'}
                </span>
              </div>
            </div>

            {/* Narrative Explanation Block */}
            <div className="mb-xl bg-primary/5 rounded-2xl p-xl border border-primary/10 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-8 -mt-8" />
              <h3 className="font-headline-md text-primary mb-md font-bold flex items-center gap-2">
                <FileText size={20} />
                Report Analysis Narrative
              </h3>
              <p className="font-body-lg text-on-surface leading-relaxed whitespace-pre-wrap">
                {selectedReport.narrative}
              </p>
            </div>

            {/* Mastery Topics Lists */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-lg">
              
              {/* Strong Topics */}
              <div className="bg-secondary-container/20 rounded-xl p-md border border-primary/10">
                <h4 className="font-label-lg text-primary mb-md font-bold flex items-center gap-2">
                  <CheckCircle2 size={18} />
                  Mastered Concepts
                </h4>
                {strongTopics.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {strongTopics.map((topic: any, idx: number) => (
                      <li key={idx} className="bg-surface rounded-lg p-sm font-body-md text-on-surface border border-outline-variant/10 shadow-sm flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary" />
                        <span>{topic.topic_name}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-body-sm text-on-surface-variant italic">
                    Take more assessments and get consistently high scores to unlock mastered concepts!
                  </p>
                )}
              </div>

              {/* Weak Topics */}
              <div className="bg-error-container/20 rounded-xl p-md border border-error/10">
                <h4 className="font-label-lg text-error mb-md font-bold flex items-center gap-2">
                  <AlertCircle size={18} />
                  Concepts to Practice
                </h4>
                {weakTopics.length > 0 ? (
                  <ul className="flex flex-col gap-2">
                    {weakTopics.map((topic: any, idx: number) => (
                      <li key={idx} className="bg-surface rounded-lg p-sm border border-outline-variant/10 shadow-sm">
                        <div className="font-body-md font-semibold text-on-surface">{topic.topic_name}</div>
                        {topic.primary_misconception_tag && (
                          <div className="text-xs font-body-sm text-on-surface-variant mt-0.5 italic capitalize">
                            Misconception: {topic.primary_misconception_tag.replace(/_/g, ' ')}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm font-body-sm text-on-surface-variant italic">
                    Great job! You have no weak concepts flagged. Keep it up!
                  </p>
                )}
              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  );
};
