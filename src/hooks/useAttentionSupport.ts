import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {backendRequest} from '../services/backendClient';
import {ATTENTION_POLL_SECONDS,observationDelta,type AttentionSnapshot} from '../services/attentionPolicy';
import type {AttentionPrompt} from '../components/AttentionPopup';

interface Input {userId?:string;sectionId?:string;enabled:boolean;paused:boolean;busy:boolean;resumeVersion:number;onOffer:(event:AttentionPrompt)=>void}
interface Decision {action:string;event:AttentionPrompt|null;reason:string;next_check_seconds:number}
interface Visit {id:string;visible:number;lastAction:number}

export function useAttentionSupport(input:Input) {
 const current=useRef(input);
 useLayoutEffect(()=>{current.current=input;},[input]);
 const visit=useRef<Visit|null>(null),lastTick=useRef(0),lastTyped=useRef(-Infinity),resumeAfter=useRef(0);
 const requestInFlight=useRef<Promise<void>|null>(null),generation=useRef(0);
 const [error,setError]=useState<string|null>(null);
 const section=input.sectionId,user=input.userId;
 const storageKey=user&&section?`attention-visit:${user}:${section}`:null;
 const observe=useCallback(async(finished=false)=>{
  if(requestInFlight.current)await requestInFlight.current;
  const state=current.current,v=visit.current;
  if(!state.userId||!state.sectionId||!v)return;
  const version=generation.current;
  const snapshot:AttentionSnapshot={section_id:state.sectionId,visit_id:v.id,
   visible_seconds:Math.floor(v.visible),idle_seconds:Math.floor(Math.max(0,v.visible-v.lastAction)),
   interruptible:!finished&&!state.paused&&!state.busy&&document.visibilityState==='visible'&&
    performance.now()-lastTyped.current>=10000&&performance.now()>=resumeAfter.current&&
    !window.speechSynthesis?.speaking&&!window.speechSynthesis?.pending,
   enabled:state.enabled,finished};
  const pending=(async()=>{
   try{
    const result=await backendRequest<Decision>('/attention/check',snapshot);
    if(version!==generation.current||finished)return;
    setError(null);
    const now=current.current;
    if(result.event&&now.enabled&&!now.paused&&!now.busy&&document.visibilityState==='visible'&&
     performance.now()-lastTyped.current>=10000&&performance.now()>=resumeAfter.current&&
     !window.speechSynthesis?.speaking&&!window.speechSynthesis?.pending)now.onOffer(result.event);
   }catch{
    if(version===generation.current&&!finished)setError('Attention support is temporarily unavailable. You can keep learning; we’ll retry automatically.');
   }
  })();
  requestInFlight.current=pending;
  try{await pending;}finally{if(requestInFlight.current===pending)requestInFlight.current=null;}
 },[]);
 useEffect(()=>{
  generation.current++;lastTick.current=performance.now();lastTyped.current=-Infinity;
  if(!storageKey){visit.current=null;return;}
  let saved:Visit|null=null;
  try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{/* Ignore damaged local state. */}
  visit.current=saved&&typeof saved.id==='string'&&Number.isFinite(saved.visible)&&saved.visible>=0&&saved.visible<=86400
   ?saved:{id:crypto.randomUUID(),visible:0,lastAction:0};
  visit.current.lastAction=visit.current.visible;
  void observe();
  const meaningful=(event:Event)=>{
   if(visit.current)visit.current.lastAction=visit.current.visible;
   if(event.type==='keydown'||event.type==='input')lastTyped.current=performance.now();
  };
  const visibility=()=>{lastTick.current=performance.now();if(visit.current)visit.current.lastAction=visit.current.visible;};
  const tick=setInterval(()=>{
   const now=performance.now(),state=current.current;
   const paused=state.paused||state.busy||document.visibilityState!=='visible'||
    !!window.speechSynthesis?.speaking||!!window.speechSynthesis?.pending;
   if(visit.current){
    visit.current.visible=Math.min(86400,visit.current.visible+observationDelta(now-lastTick.current,paused));
    sessionStorage.setItem(storageKey,JSON.stringify(visit.current));
   }
   lastTick.current=now;
  },1000);
  const poll=setInterval(()=>{if(!current.current.paused&&document.visibilityState==='visible'&&!requestInFlight.current)void observe();},ATTENTION_POLL_SECONDS*1000);
  for(const event of ['pointerdown','keydown','input','scroll'])document.addEventListener(event,meaningful,{passive:true,capture:true});
  document.addEventListener('visibilitychange',visibility);
  return()=>{
   // eslint-disable-next-line react-hooks/exhaustive-deps -- Explicitly invalidate this visit's pending responses.
   generation.current++;clearInterval(tick);clearInterval(poll);
   for(const event of ['pointerdown','keydown','input','scroll'])document.removeEventListener(event,meaningful,true);
   document.removeEventListener('visibilitychange',visibility);
  };
 },[storageKey,observe]);
 useEffect(()=>{resumeAfter.current=performance.now()+60000;if(visit.current)visit.current.lastAction=visit.current.visible;},[input.resumeVersion]);
 const resetInactivity=useCallback(()=>{if(visit.current)visit.current.lastAction=visit.current.visible;},[]);
 return {finishSection:()=>observe(true),resetInactivity,error};
}
