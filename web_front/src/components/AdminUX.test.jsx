import process from 'node:process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import ModalCloseButton from './ModalCloseButton';
import TechnicalDetails from './TechnicalDetails';
import useDialogAccessibility from '../hooks/useDialogAccessibility';
import { approvalLabel, pickupLabel, proximityLabel, requestMessage, deviceUpdateLabel, eventLabel } from '../lib/ui-language';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
function Content({close,busy=false}) {
 const ref=useRef(null);useDialogAccessibility(ref,close,{busy});
 return <section ref={ref} role="dialog" aria-label="Example details"><h2>Details</h2><ModalCloseButton disabled={busy} onClick={close}/><form><label>Name<input/></label></form><TechnicalDetails><button>Hidden technical action</button></TechnicalDetails><button>Last action</button></section>;
}
function Harness({busy=false}) {
 const [open,setOpen]=useState(false);
 return <><button onClick={()=>setOpen(true)}>Open details</button>{open&&<Content busy={busy} close={()=>setOpen(false)}/>}</>;
}
it('provides a named icon-only red X and closes/restores focus',()=>{
 render(<Harness/>);const opener=screen.getByText('Open details');opener.focus();fireEvent.click(opener);
 const close=screen.getByRole('button',{name:'Close dialog'});
 expect(close.className).toBe('cg-modal-close');expect(close.textContent).toBe('');expect(close.type).toBe('button');expect(close.querySelector('svg')).toBeTruthy();
 fireEvent.click(close);expect(screen.queryByRole('dialog')).toBeNull();expect(document.activeElement).toBe(opener);
});
it('traps Tab from the dialog, skips collapsed controls and closes with Escape',()=>{
 render(<Harness/>);fireEvent.click(screen.getByText('Open details'));
 fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close dialog'}));
 screen.getByText('Last action').focus();fireEvent.keyDown(document,{key:'Tab'});expect(document.activeElement).toBe(screen.getByRole('button',{name:'Close dialog'}));
 fireEvent.keyDown(document,{key:'Tab',shiftKey:true});expect(document.activeElement).toBe(screen.getByText('Last action'));
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps a pending operation open and blocks X and Escape',()=>{
 render(<Harness busy/>);fireEvent.click(screen.getByText('Open details'));
 expect(screen.getByRole('button',{name:'Close dialog'}).disabled).toBe(true);
 fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeTruthy();
});
it('warns before discarding edited forms and allows keeping changes',()=>{
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 render(<Harness/>);fireEvent.click(screen.getByText('Open details'));fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Unsaved name'}});
 fireEvent.click(screen.getByRole('button',{name:'Close dialog'}));expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes?');expect(screen.getByLabelText('Name').value).toBe('Unsaved name');
 confirm.mockReturnValue(true);fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps advanced values available in a closed disclosure',()=>{
 render(<TechnicalDetails><p>Stored reference number</p></TechnicalDetails>);
 const details=screen.getByText('Technical details').closest('details');expect(details.open).toBe(false);
 fireEvent.click(screen.getByText('Technical details'));expect(details.open).toBe(true);expect(screen.getByText('Stored reference number')).toBeTruthy();
});
it('keeps approval, pickup and proximity meanings separate',()=>{
 expect(approvalLabel('PENDING')).toBe('Waiting for approval');expect(pickupLabel('PENDING')).toBe('Waiting for pickup');expect(proximityLabel('UNKNOWN')).toBe('Signal not available (UNKNOWN)');expect(proximityLabel('NEAR')).toBe('Nearby (NEAR)');
});
it('uses useful permission/network errors without modifying diagnostic codes',()=>{
 const error={status:403,code:'FORBIDDEN',message:'403'};expect(requestMessage(error)).toBe('You do not have permission to perform this action.');expect(error.code).toBe('FORBIDDEN');expect(requestMessage({code:'NETWORK_ERROR'})).toContain('Check your connection');
});

it('opens advanced form fields when native validation reports an invalid value',()=>{
 render(<TechnicalDetails><label>Advanced limit<input required type="number" min="1" defaultValue="0"/></label></TechnicalDetails>);
 const details=screen.getByText('Technical details').closest('details');expect(details.open).toBe(false);
 fireEvent.invalid(screen.getByLabelText('Advanced limit'));expect(details.open).toBe(true);
});

it('does not call an unprocessed device approach report a recorded alert',()=>{
 expect(deviceUpdateLabel('DANGER_ZONE_NEAR')).toBe('Danger-zone approach report');
 expect(eventLabel('DANGER_ZONE_NEAR')).toBe('Danger-zone alert');
});

it('does not include generic page guides anywhere in active source',()=>{
 const root=join(process.cwd(),'src');
 const files=readdirSync(root,{recursive:true}).filter(name=>/\.(jsx|js)$/.test(name)&&!name.includes('.test.'));
 for(const name of files){const content=readFileSync(join(root,name),'utf8');expect(content).not.toContain('PageGuide');expect(content).not.toContain('How to use this page');}
});
it('bounds desktop dialog sizes without a viewport-only maximum',()=>{
 const css=readFileSync(join(process.cwd(),'src/style/AdminUX.css'),'utf8');
 expect(css).toContain('--cg-dialog-width:700px');expect(css).toContain('--cg-dialog-width:460px');expect(css).toContain('--cg-dialog-width:800px');expect(css).toContain('--cg-dialog-width:900px');
 expect(css).toContain('max-width:min(var(--cg-dialog-width),calc(100vw - 32px))');expect(css).toContain('max-height:min(88dvh,calc(100dvh - 32px))');
 expect(css).not.toContain('.cg-page-guide');
});
