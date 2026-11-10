import {useRef,useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import useDialogAccessibility,{canDismissDialog} from '../hooks/useDialogAccessibility';
import ModalCloseButton from './ModalCloseButton';

afterEach(()=>{cleanup();vi.restoreAllMocks();document.body.style.overflow='';});
function Layer({level,onClose,onOpen,busy=false,children}){
 const ref=useRef(null);useDialogAccessibility(ref,onClose,{busy});
 return <div className="test-modal-overlay" data-testid={`overlay-${level}`} onClick={event=>{if(event.target===event.currentTarget&&canDismissDialog(ref.current)){event.stopPropagation();onClose();}}}>
  <section ref={ref} role="dialog" aria-modal="true" aria-label={`Layer ${level}`} data-testid={`layer-${level}`}>
   <ModalCloseButton disabled={busy} onClick={onClose}/><form><label>Input {level}<input defaultValue={`Value ${level}`}/></label></form>
   <details><summary>Details {level}</summary><p>Saved parent context</p></details>
   <button onClick={onOpen}>Open next {level}</button>{children}
  </section>
 </div>;
}
function Harness({busy=false,hideParent=false,nested=false}){
 const [count,setCount]=useState(0),[background,setBackground]=useState(0);
 const layer=level=><Layer key={level} level={level} busy={busy&&level===count} onClose={()=>setCount(n=>n-1)} onOpen={()=>setCount(n=>n+1)}>{nested&&level<count?layer(level+1):null}</Layer>;
 return <><button onClick={()=>setCount(1)}>Open parent</button><button onClick={()=>setBackground(n=>n+1)}>Background {background}</button>{nested?count>0&&layer(1):Array.from({length:count},(_,i)=>i+1).filter(level=>!hideParent||level!==1).map(layer)}</>;
}
function openLevels(n=2){const opener=screen.getByText('Open parent');opener.focus();fireEvent.click(opener);for(let i=1;i<n;i++)fireEvent.click(screen.getByText(`Open next ${i}`));return opener;}

it('keeps three mounted layers, isolates inactive content and dismisses one Escape layer at a time',()=>{
 render(<Harness/>);const opener=openLevels(3);
 expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(3);
 expect(screen.getAllByRole('dialog')).toHaveLength(1);
 expect(screen.getByTestId('layer-1').getAttribute('aria-modal')).toBe('false');
 expect(screen.getByTestId('layer-2').closest('[inert]')).toBeTruthy();
 const layers=[1,2,3].map(n=>Number(screen.getByTestId(`overlay-${n}`).style.zIndex));expect(layers[2]).toBeGreaterThan(layers[1]);expect(layers[1]).toBeGreaterThan(layers[0]);
 for(const remaining of [2,1,0]){fireEvent.keyDown(document,{key:'Escape'});expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(remaining);}
 expect(document.activeElement).toBe(opener);expect(document.body.style.overflow).toBe('');
});
it('restores focus, scroll, expanded details and input state without remounting the parent',()=>{
 render(<Harness/>);openLevels(1);const parent=screen.getByRole('dialog'),trigger=within(parent).getByText('Open next 1');
 parent.scrollTop=284;parent.scrollLeft=7;const details=within(parent).getByText('Details 1').closest('details');details.open=true;
 fireEvent.change(within(parent).getByLabelText('Input 1'),{target:{value:'Parent edits'}});
 trigger.focus();fireEvent.click(trigger);expect(document.activeElement).toBe(screen.getByRole('dialog',{name:'Layer 2'}));
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Close dialog'}));
 expect(screen.getByRole('dialog')).toBe(parent);expect(parent.scrollTop).toBe(284);expect(parent.scrollLeft).toBe(7);
 expect(details.open).toBe(true);expect(within(parent).getByLabelText('Input 1').value).toBe('Parent edits');expect(document.activeElement).toBe(trigger);
 expect(document.body.style.overflow).toBe('hidden');
});
it('keeps body locked through out-of-order parent cleanup and restores the original lock only after the last layer',()=>{
 document.body.style.overflow='clip';const {rerender}=render(<Harness/>);openLevels(2);
 rerender(<Harness hideParent/>);expect(document.body.style.overflow).toBe('hidden');
 fireEvent.keyDown(document,{key:'Escape'});expect(document.body.style.overflow).toBe('clip');
 expect(document.querySelector('[data-cg-dialog-layer]')).toBeNull();
});
it('blocks pointer and focus access behind the active dialog; Tab stays in its own controls',()=>{
 render(<Harness/>);openLevels(2);const top=screen.getByRole('dialog');
 fireEvent.click(screen.getByText('Background 0'));expect(screen.getByText('Background 0')).toBeTruthy();
 screen.getByText('Background 0').focus();expect(top.contains(document.activeElement)).toBe(true);
 within(top).getByText('Open next 2').focus();fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(within(top).getByRole('button',{name:'Close dialog'}));
 fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(within(top).getByText('Open next 2'));
});
it('keeps backdrop dismissal on the active layer only and ignores clicks inside it',()=>{
 render(<Harness/>);openLevels(2);const top=screen.getByRole('dialog');
 fireEvent.mouseDown(within(top).getByLabelText('Input 2'));expect(screen.getByRole('dialog')).toBe(top);
 fireEvent.click(screen.getByTestId('overlay-1'));expect(screen.getByRole('dialog')).toBe(top);
 fireEvent.click(screen.getByTestId('overlay-2'));expect(screen.getByRole('dialog',{name:'Layer 1'})).toBeTruthy();
 expect(screen.queryByTestId('overlay-2')).toBeNull();
});
it('waits for a complete backdrop click before removing its layer, avoiding a release onto the parent',()=>{
 render(<Harness/>);openLevels(2);const child=screen.getByRole('dialog');
 fireEvent.mouseDown(screen.getByTestId('overlay-2'));expect(screen.getByRole('dialog')).toBe(child);
 fireEvent.mouseUp(screen.getByTestId('overlay-2'));fireEvent.click(screen.getByTestId('overlay-2'));
 expect(screen.getByRole('dialog',{name:'Layer 1'})).toBeTruthy();expect(screen.getByText('Background 0')).toBeTruthy();
});
it('respects dirty and busy restrictions without closing the parent or showing duplicate discard prompts',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);const {rerender}=render(<Harness/>);openLevels(2);
 fireEvent.change(screen.getByLabelText('Input 2'),{target:{value:'Child edits'}});fireEvent.keyDown(document,{key:'Escape'});expect(confirm).toHaveBeenCalledTimes(1);expect(screen.getByRole('dialog',{name:'Layer 2'})).toBeTruthy();
 rerender(<Harness busy/>);fireEvent.click(screen.getByTestId('overlay-2'));fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog',{name:'Layer 2'})).toBeTruthy();expect(confirm).toHaveBeenCalledTimes(1);
 rerender(<Harness/>);confirm.mockReturnValue(true);fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog',{name:'Layer 1'})).toBeTruthy();expect(confirm).toHaveBeenCalledTimes(2);
});
it('supports physically nested dialog implementations without hiding the active descendant',()=>{
 render(<Harness nested/>);openLevels(2);const child=screen.getByRole('dialog',{name:'Layer 2'});
 expect(child.closest('[inert]')).toBeNull();expect(child.closest('[aria-hidden="true"]')).toBeNull();
 fireEvent.click(screen.getByTestId('overlay-2'));expect(screen.getByRole('dialog',{name:'Layer 1'})).toBeTruthy();
});
it('removes document listeners and isolation after unmount, and new dialogs do not inherit stale listeners',()=>{
 const close=vi.fn();const {unmount}=render(<Layer level={1} onClose={close}/>);unmount();
 fireEvent.keyDown(document,{key:'Escape'});expect(close).not.toHaveBeenCalled();expect(document.querySelector('[inert]')).toBeNull();
 render(<Harness/>);openLevels(1);fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
