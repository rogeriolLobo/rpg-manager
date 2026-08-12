import { useEffect, useId, useRef } from 'react';

declare global { interface Window { turnstile?: { render: (target:string, options:Record<string,unknown>)=>string; remove:(id:string)=>void } } }
export function Turnstile({ onToken }: { onToken: (token:string)=>void }) {
  const reactId=useId(); const id=`turnstile-${reactId.replaceAll(':','')}`; const widget=useRef<string|undefined>(undefined); const sitekey=import.meta.env.VITE_TURNSTILE_SITE_KEY as string|undefined;
  useEffect(()=>{if(!sitekey)return;const render=()=>{if(window.turnstile&&!widget.current)widget.current=window.turnstile.render(`#${id}`,{sitekey,theme:'light',callback:onToken,'expired-callback':()=>onToken('')});};
    const existing=window.document.querySelector<HTMLScriptElement>('script[data-rpg-turnstile]');if(existing){render();existing.addEventListener('load',render);return()=>existing.removeEventListener('load',render);}const script=window.document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.defer=true;script.dataset.rpgTurnstile='true';script.addEventListener('load',render);window.document.head.appendChild(script);return()=>{if(widget.current)window.turnstile?.remove(widget.current);};},[id,onToken,sitekey]);
  return sitekey?<div id={id} className="turnstile"/>:<p className="form-hint">Turnstile será exigido no ambiente de produção.</p>;
}
