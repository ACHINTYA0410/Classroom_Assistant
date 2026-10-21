/** Transport guards only. The Teaching Agent owns intervention timing and selection. */
export const ATTENTION_POLL_SECONDS = 15;
export interface AttentionSnapshot {
 section_id:string; visit_id:string; visible_seconds:number; idle_seconds:number;
 interruptible:boolean; enabled:boolean; finished:boolean;
}
export function observationDelta(elapsedMilliseconds:number,paused:boolean) {
 return paused ? 0 : Math.max(0, Math.min(2, elapsedMilliseconds / 1000));
}
