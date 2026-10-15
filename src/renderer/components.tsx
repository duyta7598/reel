import { useEffect, useRef, type ReactNode } from 'react'
import { X, LoaderCircle, Ellipsis, Film } from 'lucide-react'
import type { Language } from '../shared/types'
import { translate } from './i18n'
export function Spinner({label}:{label?:string}){return <div className="spinner"><LoaderCircle className="spin" size={22}/>{label&&<span>{label}</span>}</div>}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
  const ref=useRef<HTMLDialogElement>(null)
  useEffect(()=>{const element=ref.current;element?.showModal();return()=>element?.close()},[])
  return <dialog ref={ref} className={wide?'modal wide':'modal'} onCancel={onClose}><header><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={19}/></button></header>{children}</dialog>
}
export function Empty({title,description,action}:{title:string;description?:string;action?:ReactNode}){return <div className="empty"><Film size={42}/><h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>}
export function Menu({children,label='Options'}:{children:ReactNode;label?:string}){return <details className="menu"><summary aria-label={label}><Ellipsis size={20}/></summary><div className="menu-content" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.parentElement?.removeAttribute('open')}}>{children}</div></details>}
export function ErrorLine({error,onDismiss}:{error:string;onDismiss?:()=>void}){return error?<div className="error-line" role="alert"><span>{error}</span>{onDismiss&&<button className="icon-button" aria-label="Dismiss" onClick={onDismiss}><X size={15}/></button>}</div>:null}
export function Poster({url,title}:{url?:string;title:string}){
  const ref=useRef<HTMLImageElement>(null)
  return <div className={url?"poster skeleton":"poster"}>{url?<img ref={ref} src={url} alt={title} loading="lazy" onLoad={event=>event.currentTarget.parentElement?.classList.remove('skeleton')} onError={event=>{event.currentTarget.style.display='none';event.currentTarget.parentElement?.classList.remove('skeleton')}}/>:null}<div className="poster-fallback"><Film size={36}/><span>{title}</span></div></div>
}
export function bytes(value:number){if(!value)return '0 B';const unit=Math.min(4,Math.floor(Math.log(value)/Math.log(1024)));return `${(value/1024**unit).toFixed(unit?1:0)} ${['B','KB','MB','GB','TB'][unit]}`}
export function clock(value:number){const seconds=Math.max(0,Math.floor(value));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].filter((_,index)=>index>0||seconds>=3600).map((part,index)=>index?String(part).padStart(2,'0'):String(part)).join(':')}
export const tFor=(language:Language)=>(key:string)=>translate(language,key)
