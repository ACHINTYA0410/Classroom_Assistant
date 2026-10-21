export interface OrderedSession {
  sessionId: string;
  orderIndex: number;
  status: 'not_started' | 'in_progress' | 'completed';
}

// Check every predecessor, not just the previous day: older records can contain gaps.
export function sessionIsLocked(session: OrderedSession, sessions: OrderedSession[]) {
  return sessions.some(previous => previous.orderIndex < session.orderIndex && previous.status !== 'completed');
}

export function weekIsComplete(sessions: OrderedSession[]) {
  return sessions.length > 0 && sessions.every(session => session.status === 'completed');
}
