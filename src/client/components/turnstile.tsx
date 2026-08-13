import { useEffect, useId, useRef } from 'react';
import { useTheme } from '../theme/ThemeProvider';

declare global { interface Window { turnstile?: { render: (target:string, options:Record<string,unknown>)=>string; remove:(id:string)=>void } } }
export function Turnstile({ onToken }: { onToken: (token:string)=>void }) {
  const reactId=useId(); const id=`turnstile-${reactId.replaceAll(':','')}`; const widget=useRef<string|undefined>(undefined); const sitekey=import.meta.env.VITE_TURNSTILE_SITE_KEY as string|undefined;
  const {resolvedTheme}=useTheme();
  useEffect(()=>{if(!sitekey)return;const render=()=>{if(window.turnstile&&!widget.current)widget.current=window.turnstile.render(`#${id}`,{sitekey,theme:resolvedTheme,callback:onToken,'expired-callback':()=>onToken('')});};
    const existing=window.document.querySelector<HTMLScriptElement>('script[data-rpg-turnstile]');const script=existing??window.document.createElement('script');if(!existing){script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.defer=true;script.dataset.rpgTurnstile='true';window.document.head.appendChild(script);}render();script.addEventListener('load',render);return()=>{script.removeEventListener('load',render);if(widget.current){window.turnstile?.remove(widget.current);widget.current=undefined;}};},[id,onToken,resolvedTheme,sitekey]);
  return sitekey?<div id={id} className="turnstile"/>:<p className="form-hint">Turnstile será exigido no ambiente de produção.</p>;
}
