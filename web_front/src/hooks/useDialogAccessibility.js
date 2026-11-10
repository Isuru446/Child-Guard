import {useLayoutEffect,useRef} from 'react';

const stack=[];
let overflow='',isolation=new Map();
const attributes=['inert','aria-hidden'];
const remember=node=>{if(!isolation.has(node))isolation.set(node,Object.fromEntries(attributes.map(key=>[key,node.getAttribute(key)])));};
function restoreIsolation(){for(const [node,values] of isolation)for(const [key,value] of Object.entries(values)){if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}isolation=new Map();}
export const topDialog=()=>stack.at(-1)?.node;
export function canDismissDialog(node=topDialog()){
 const entry=stack.find(item=>item.node===node);
 if(stack.length&&node!==topDialog())return false;
 if(entry?.current.current.busy)return false;
 if(node?.dataset.unsaved==='true'){
  if(!window.confirm('Discard your unsaved changes?'))return false;
  delete node.dataset.unsaved;
 }
 return true;
}
export function dialogControls(node){
 return [...(node?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')||[])].filter(el=>!el.closest('[hidden],[inert]')&&el.getAttribute('aria-hidden')!=='true'&&!el.matches('input[type="hidden"]')&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'&&![...node.querySelectorAll('details:not([open])')].some(details=>details.contains(el)&&details.querySelector('summary')!==el));
}
const focus=node=>node?.focus({preventScroll:true});
function sync(){
 restoreIsolation();
 const active=topDialog();
 for(const [index,entry] of stack.entries()){
  entry.layer.style.zIndex=String(2100+index*2);
  entry.layer.dataset.cgDialogLayer=String(index);
  entry.node.setAttribute('aria-modal',String(entry.node===active));
  // If an implementation physically nests dialog nodes, hide only sibling
  // branches, not an ancestor that would make the active child inert too.
  entry.node.setAttribute('role',entry.node!==active&&entry.node.contains(active)?'presentation':entry.role||'dialog');
 }
 if(!active)return;
 for(let branch=active;branch&&branch!==document.body;branch=branch.parentElement){
  for(const sibling of branch.parentElement?.children??[]){
   if(sibling===branch||['SCRIPT','STYLE','LINK'].includes(sibling.tagName))continue;
   remember(sibling);sibling.setAttribute('inert','');sibling.setAttribute('aria-hidden','true');
  }
 }
}
function keydown(event){
 const entry=stack.at(-1);if(!entry||event.defaultPrevented)return;
 if(event.key==='Escape'){
  event.preventDefault();
  // One shared listener snapshots one entry. A synchronous close cannot expose
  // another listener that dismisses the parent for the same keypress.
  if(canDismissDialog(entry.node))entry.current.current.onClose();
 }else if(event.key==='Tab'){
  const controls=dialogControls(entry.node),first=controls[0],last=controls.at(-1);
  if(!first){event.preventDefault();focus(entry.node);return;}
  if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();focus(last);}
  else if(!event.shiftKey&&(document.activeElement===last||!controls.includes(document.activeElement))){event.preventDefault();focus(first);}
 }
}
function focusin(event){const node=topDialog();if(node&&!node.contains(event.target))focus(dialogControls(node)[0]||node);}
function pointer(event){
 const entry=stack.at(-1);if(!entry)return;
 // Only the active content or its own backdrop may receive pointer actions.
 // Existing React backdrop handlers decide whether dismissal is permitted.
 if(entry.node.contains(event.target)||event.target===entry.layer)return;
 event.preventDefault();event.stopPropagation();
}
function listeners(add){
 const method=add?'addEventListener':'removeEventListener';
 document[method]('keydown',keydown);document[method]('focusin',focusin);
 for(const type of ['pointerdown','mousedown','click'])document[method](type,pointer,true);
}
export default function useDialogAccessibility(ref,onClose,{open=true,busy=false,dirty=false}={}){
 const current=useRef({onClose,busy,dirty});
 useLayoutEffect(()=>{current.current={onClose,busy,dirty};if(dirty&&ref.current)ref.current.dataset.unsaved='true';},[onClose,busy,dirty,ref]);
 useLayoutEffect(()=>{
  if(!open)return;
  const node=ref.current;if(!node)return;
  const parent=node.parentElement;
  const layer=parent?.matches('[class*="modal-overlay"],[class*="modal__overlay"]')?parent:node;
  const entry={node,layer,current,previous:document.activeElement,role:node.getAttribute('role'),ariaModal:node.getAttribute('aria-modal'),tabIndex:node.getAttribute('tabindex'),zIndex:layer.style.zIndex,level:layer.getAttribute('data-cg-dialog-layer'),scroll:stack.map(item=>[item.node,item.node.scrollTop,item.node.scrollLeft])};
  if(!stack.length){overflow=document.body.style.overflow;document.body.style.overflow='hidden';listeners(true);}
  const child=stack.findIndex(item=>node.contains(item.node));
  if(child===-1)stack.push(entry);else stack.splice(child,0,entry);
  node.setAttribute('tabindex','-1');sync();focus(topDialog());
  const changed=event=>{if(event.target.closest('[role="dialog"]')===node&&event.target.closest('form'))node.dataset.unsaved='true';};
  node.addEventListener('input',changed);node.addEventListener('change',changed);
  return()=>{
   const wasTop=topDialog()===node,index=stack.indexOf(entry);if(index!==-1)stack.splice(index,1);
   node.removeEventListener('input',changed);node.removeEventListener('change',changed);
   restoreIsolation();layer.style.zIndex=entry.zIndex;
   for(const [key,value] of [['role',entry.role],['aria-modal',entry.ariaModal],['tabindex',entry.tabIndex]]){if(value===null)node.removeAttribute(key);else node.setAttribute(key,value);}
   if(entry.level===null)layer.removeAttribute('data-cg-dialog-layer');else layer.setAttribute('data-cg-dialog-layer',entry.level);
   sync();
   if(!stack.length){listeners(false);document.body.style.overflow=overflow;}
   if(wasTop){
    for(const [parent,top,left] of entry.scroll)if(parent.isConnected){parent.scrollTop=top;parent.scrollLeft=left;}
    const next=topDialog();
    if(entry.previous?.isConnected&&(!next||next.contains(entry.previous)))focus(entry.previous);
    else if(next)focus(next);
   }
  };
 },[open,ref]);
}
