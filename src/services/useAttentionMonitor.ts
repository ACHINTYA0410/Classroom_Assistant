/**
 * useAttentionMonitor — DEPRECATED stub kept for import compatibility.
 *
 * Attention monitoring is now handled directly in LessonSession.tsx via
 * the real `activeSeconds` value from SessionContext. The check-in trigger
 * fires every ATTENTION_INTERVAL_SECONDS of real active time (not wall-clock).
 *
 * This file is retained so any external import doesn't break;
 * it exports a no-op hook.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function
export const useAttentionMonitor = () => {};
