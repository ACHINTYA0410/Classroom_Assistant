import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStudentAgentDecisions } from '../services/api';
import { ArrowLeft, RefreshCw, Cpu, Brain, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface AgentDecision {
  id: string;
  agent_name: 'teaching_agent' | 'quiz_agent' | 'report_agent';
  decision_type: string;
  linked_entity_id: string | null;
  input_snapshot: any;
  output: any;
  reasoning_summary: string | null;
  created_at: string;
}

export const AgentAuditView = () => {
  const navigate = useNavigate();
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchDecisions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStudentAgentDecisions();
      setDecisions(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load agent decisions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDecisions();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getAgentIcon = (agent: string) => {
    switch (agent) {
      case 'teaching_agent': return <Brain className="text-blue-500" size={18} />;
      case 'quiz_agent': return <Cpu className="text-emerald-500" size={18} />;
      case 'report_agent': return <FileText className="text-amber-500" size={18} />;
      default: return <Brain size={18} />;
    }
  };

  const getAgentLabel = (agent: string) => {
    switch (agent) {
      case 'teaching_agent': return 'Teaching Agent';
      case 'quiz_agent': return 'Quiz Agent';
      case 'report_agent': return 'Report Agent';
      default: return agent;
    }
  };

  return (
    <div className="flex flex-col gap-lg p-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/educator')}
            className="p-2 rounded-full hover:bg-surface-container transition-colors text-on-surface-variant"
            title="Back to Educator Dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface">Agent Decision Audit Log</h1>
            <p className="font-body-sm text-on-surface-variant">Chronological trace of multi-agent AI system decisions</p>
          </div>
        </div>
        <button
          onClick={fetchDecisions}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="bg-error-container/25 border border-error/30 text-error p-md rounded-xl font-body-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-xl font-body-md text-on-surface-variant">Loading decisions history...</div>
      ) : decisions.length === 0 ? (
        <div className="text-center py-xl border-2 border-dashed border-outline-variant/40 rounded-2xl bg-surface-variant/10 text-on-surface-variant">
          No agent decisions recorded yet for this student. Complete some lessons, ask queries, or finish a quiz to generate decision logs.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {decisions.map((decision) => {
            const isExpanded = expandedId === decision.id;
            const formattedTime = new Date(decision.created_at).toLocaleString();

            return (
              <div
                key={decision.id}
                className="border border-outline-variant/40 rounded-xl bg-surface-container-lowest overflow-hidden transition-all shadow-[0_2px_8px_rgba(0,0,0,0.01)]"
              >
                {/* Header Summary Row */}
                <div
                  onClick={() => toggleExpand(decision.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-md gap-sm cursor-pointer hover:bg-surface-container-low transition-colors"
                >
                  <div className="flex items-center gap-md">
                    <div className="p-2 bg-surface rounded-lg shadow-sm border border-outline-variant/30">
                      {getAgentIcon(decision.agent_name)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-label-lg font-bold text-on-surface">
                          {getAgentLabel(decision.agent_name)}
                        </span>
                        <span className="px-2.5 py-0.5 bg-surface-container-highest text-on-surface-variant text-[11px] font-bold rounded-full border border-outline-variant/30">
                          {decision.decision_type}
                        </span>
                      </div>
                      <p className="font-body-sm text-on-surface-variant mt-0.5 line-clamp-1">
                        {decision.reasoning_summary || 'No reasoning summary provided.'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-md self-stretch sm:self-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-outline-variant/20">
                    <span className="font-label-sm text-on-surface-variant text-xs">
                      {formattedTime}
                    </span>
                    <div className="text-on-surface-variant">
                      {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                  </div>
                </div>

                {/* Expanded Details Pane */}
                {isExpanded && (
                  <div className="bg-surface-container-low/30 border-t border-outline-variant/20 p-md flex flex-col gap-md animate-fade-in text-xs font-mono">
                    {/* Linked Entity ID */}
                    {decision.linked_entity_id && (
                      <div className="flex gap-2 items-center">
                        <span className="font-bold text-on-surface-variant uppercase tracking-wider text-[10px]">Linked Entity ID:</span>
                        <span className="bg-surface px-2 py-0.5 rounded border border-outline-variant/30">{decision.linked_entity_id}</span>
                      </div>
                    )}

                    {/* Reasoning Details */}
                    <div>
                      <span className="font-bold text-on-surface-variant uppercase tracking-wider text-[10px] block mb-1">Reasoning Summary:</span>
                      <p className="font-body-sm text-on-surface bg-surface-container p-md rounded-lg border border-outline-variant/30 leading-relaxed font-sans">
                        {decision.reasoning_summary || 'N/A'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-md">
                      {/* Input Snapshot */}
                      <div>
                        <span className="font-bold text-on-surface-variant uppercase tracking-wider text-[10px] block mb-1">Input Snapshot:</span>
                        <pre className="bg-surface-container-highest p-md rounded-lg border border-outline-variant/40 overflow-x-auto max-h-60 text-[11px] leading-tight">
                          {JSON.stringify(decision.input_snapshot, null, 2)}
                        </pre>
                      </div>

                      {/* Output */}
                      <div>
                        <span className="font-bold text-on-surface-variant uppercase tracking-wider text-[10px] block mb-1">Agent Output:</span>
                        <pre className="bg-surface-container-highest p-md rounded-lg border border-outline-variant/40 overflow-x-auto max-h-60 text-[11px] leading-tight">
                          {JSON.stringify(decision.output, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
