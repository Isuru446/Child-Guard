import {useRef,useState} from 'react';
import ActionButton from './ActionButton';

// Public identifiers only. Credentials/hashes never belong in this component.
export default function DeviceIdentity({device}){
 const input=useRef(null),[copyState,setCopyState]=useState('');
 async function copy(){
  setCopyState('');
  try{
   if(!navigator.clipboard?.writeText)throw Error('Clipboard unavailable');
   await navigator.clipboard.writeText(device.id);setCopyState('copied');
  }catch{setCopyState('failed');input.current?.focus();input.current?.select();}
 }
 return <>
  <dl><dt>Device ID (firmware DEVICE_ID)</dt><dd>{device.hardwareId||'Not returned'}</dd><dt>Device Reference Number (UUID)</dt><dd><input ref={input} aria-label="Database Device UUID" value={device.id||''} readOnly autoComplete="off"/><ActionButton disabled={!device.id} onClick={copy}>Copy UUID</ActionButton></dd><dt>Center reference</dt><dd>{device.centerId||'Your authenticated daycare center'}</dd></dl>
  {copyState==='copied'&&<p role="status">Device UUID copied.</p>}{copyState==='failed'&&<p role="alert">Clipboard unavailable. Select the UUID above and press Ctrl+C.</p>}
  <p>The system creates this reference number automatically. The belt uses the Device ID above. Bluetooth beacon codes are separate and belong to the Gate or danger-zone beacon.</p>
 </>;
}
