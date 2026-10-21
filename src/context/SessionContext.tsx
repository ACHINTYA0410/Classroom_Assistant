import React,{createContext,useContext,useState,useRef,useCallback,useEffect} from 'react';
import { useAuth } from './AuthContext';
import { upsertSessionProgress,completeSession,flushActiveSeconds,requestBreak,resumeBreak,getBreakStatus,saveBreakActivities } from '../services/sessionService';
import type { BreakStatus,LearningBreak,BreakActivity } from '../services/sessionService';

interface SessionContextType {
 sessionProgressId:string|null; activeSeconds:number; isOnBreak:boolean;
 currentBreak:LearningBreak|null; breakElapsed:number; breakLoading:boolean; breakError:string|null;
 breakMessage:string|null; resumeVersion:number;
 startSession:(sessionId:string)=>Promise<void>; markDone:()=>Promise<void>; takeBreak:()=>Promise<void>;
 resumeFromBreak:(timeout?:boolean)=>Promise<void>; flushTime:()=>Promise<void>; pauseSession:()=>void;
 updateActivities:(activities:BreakActivity[])=>Promise<void>; clearBreakMessage:()=>void;
}
const SessionContext=createContext<SessionContextType|undefined>(undefined);
export const SessionProvider=({children}:{children:React.ReactNode})=>{
 const {user}=useAuth();
 const userId=user?.id;
 const [sessionProgressId,setProgress]=useState<string|null>(null);
 const [activeSeconds,setSeconds]=useState(0);
 const [currentBreak,setBreak]=useState<LearningBreak|null>(null);
 const [breakElapsed,setElapsed]=useState(0);
 const [breakLoading,setLoading]=useState(true);
 const [breakError,setError]=useState<string|null>(null);
 const [breakMessage,setMessage]=useState<string|null>(null);
 const [resumeVersion,setResumeVersion]=useState(0);
 const progress=useRef<string|null>(null),seconds=useRef(0),paused=useRef(true);
 const breakRef=useRef<LearningBreak|null>(null),activities=useRef<BreakActivity[]>([]);
 const clock=useRef({elapsed:0,received:0});
 const seenEnd=useRef<string|null>(null);
 const generation=useRef(0),mountedSession=useRef(false),closing=useRef(false),opening=useRef(false);
 const applyStatus=useCallback((status:BreakStatus)=>{
  const had=!!breakRef.current;
  breakRef.current=status.break; setBreak(status.break);
  if(status.break){
   activities.current=status.break.activities||[];
   const elapsed=Math.max(0,(Date.parse(status.server_now)-Date.parse(status.break.break_start))/1000);
   clock.current={elapsed,received:performance.now()};setElapsed(Math.floor(elapsed));
  }else if(had||status.expired||(status.recent_end?.ended_reason==='expired_while_away'&&seenEnd.current!==status.recent_end.id)){
   setResumeVersion(v=>v+1);setMessage(status.expired||status.recent_end?.ended_reason==='expired_while_away'?'Your break has ended. Welcome back, gently.':'Welcome back. Let’s continue calmly.');
  }
  if(status.recent_end)seenEnd.current=status.recent_end.id;
  setLoading(false);setError(null);
 },[]);
 const refresh=useCallback(async()=>{
  if(!userId)return;
  const identityGeneration=generation.current;
  try{const status=await getBreakStatus();if(identityGeneration===generation.current)applyStatus(status);}
  catch(error){setLoading(false);setError(error instanceof Error?error.message:'Could not check your break.');}
 },[userId,applyStatus]);
 useEffect(()=>{
  generation.current++;progress.current=null;seconds.current=0;paused.current=true;mountedSession.current=false;
  breakRef.current=null;seenEnd.current=null;setBreak(null);setProgress(null);setSeconds(0);setLoading(!!userId);setError(null);
  if(!userId)return;
  void refresh();
  const poll=setInterval(()=>{if(!breakRef.current)void refresh();},15000);
  const focus=()=>void refresh();
  window.addEventListener('focus',focus);
  return()=>{clearInterval(poll);window.removeEventListener('focus',focus);};
 },[userId,refresh]);
 useEffect(()=>{
  const tick=setInterval(()=>{
   if(breakRef.current){
    setElapsed(Math.min(breakRef.current.allowed_seconds,Math.floor(clock.current.elapsed+(performance.now()-clock.current.received)/1000)));
   }else if(!paused.current&&mountedSession.current&&progress.current&&!opening.current&&document.visibilityState==='visible'){
    seconds.current++;setSeconds(seconds.current);
    if(seconds.current%15===0)void flushActiveSeconds(progress.current,seconds.current).catch(e=>setError(e.message));
   }
  },1000);
  return()=>clearInterval(tick);
 },[]);
 const startSession=useCallback(async(sessionId:string)=>{
  const token=++generation.current; paused.current=true;mountedSession.current=true;progress.current=null;setProgress(null);
  if(!userId)return;
  const status=await getBreakStatus();
  if(token!==generation.current)return;
  applyStatus(status);
  if(status.break)return;
  const row=await upsertSessionProgress(sessionId,userId);
  if(token!==generation.current)return;
  progress.current=row?.id||null;setProgress(progress.current);
  seconds.current=row?.totalActiveSeconds||0;setSeconds(seconds.current);paused.current=false;
 },[userId,applyStatus]);
 const flushTime=useCallback(async()=>{
  if(progress.current&&!breakRef.current&&!opening.current)await flushActiveSeconds(progress.current,seconds.current);
 },[]);
 const pauseSession=useCallback(()=>{paused.current=true;mountedSession.current=false;generation.current++;},[]);
 const markDone=useCallback(async()=>{
  if(breakRef.current||opening.current)throw new Error('Resume your break first.');
  if(!progress.current)throw new Error('Start the lesson before completing it.');
  await completeSession(progress.current,seconds.current);
  paused.current=true;progress.current=null;setProgress(null);
 },[]);
 const takeBreak=useCallback(async()=>{
  if(!progress.current||breakRef.current||opening.current)return;
  opening.current=true;paused.current=true;setError(null);
  try{
   await flushActiveSeconds(progress.current,seconds.current);
   applyStatus(await requestBreak(progress.current));
  }catch(e){setError(e instanceof Error?e.message:'Could not start break.');paused.current=false;}
  finally{opening.current=false;}
 },[applyStatus]);
 const resumeFromBreak=useCallback(async(timeout=false)=>{
  if(!breakRef.current||closing.current)return;
  closing.current=true;
  try{
   const lessonId=breakRef.current.session_id;
   const status=await resumeBreak(breakRef.current.id,activities.current,timeout);
   applyStatus(status);
   if(!progress.current&&userId&&mountedSession.current){
    const row=await upsertSessionProgress(lessonId,userId);
    progress.current=row?.id||null;setProgress(progress.current);seconds.current=row?.totalActiveSeconds||0;setSeconds(seconds.current);
   }
   paused.current=false;
  }catch(e){setError(e instanceof Error?e.message:'Could not resume.');}
  finally{closing.current=false;}
 },[applyStatus,userId]);
 useEffect(()=>{
  if(currentBreak&&breakElapsed>=currentBreak.allowed_seconds)void resumeFromBreak(true);
 },[currentBreak,breakElapsed,resumeFromBreak]);
 useEffect(()=>{
  const save=()=>{if(breakRef.current&&activities.current.length)void saveBreakActivities(breakRef.current.id,activities.current).catch(()=>{});else if(progress.current&&!breakRef.current)void flushActiveSeconds(progress.current,seconds.current,true).catch(()=>{});};
  const visibility=()=>{if(document.visibilityState==='hidden')save();};
  window.addEventListener('pagehide',save);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('pagehide',save);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const updateActivities=useCallback(async(value:BreakActivity[])=>{
  activities.current=value;
  if(breakRef.current && value.reduce((n,a)=>n+a.seconds,0)%10===0)await saveBreakActivities(breakRef.current.id,value);
 },[]);
 return <SessionContext.Provider value={{sessionProgressId,activeSeconds,isOnBreak:!!currentBreak,currentBreak,breakElapsed,
  breakLoading,breakError,breakMessage,resumeVersion,startSession,markDone,takeBreak,resumeFromBreak,flushTime,pauseSession,
  updateActivities,clearBreakMessage:()=>setMessage(null)}}>{children}</SessionContext.Provider>;
};
export const useSession=()=>{const value=useContext(SessionContext);if(!value)throw new Error('SessionProvider missing');return value;};
