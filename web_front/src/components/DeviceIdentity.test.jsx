import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import DeviceIdentity from './DeviceIdentity';
const originalClipboard=Object.getOwnPropertyDescriptor(navigator,'clipboard');
const device={id:'12345678-1234-4234-8234-123456789abc',hardwareId:'CG-WEARABLE-001',centerId:'center-a'};
afterEach(()=>{cleanup();if(originalClipboard)Object.defineProperty(navigator,'clipboard',originalClipboard);else delete navigator.clipboard;});
it('copies only the database UUID, never the firmware ID',async()=>{
 const writeText=vi.fn(async()=>{});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
 render(<DeviceIdentity device={device}/>);fireEvent.click(screen.getByRole('button',{name:'Copy UUID'}));
 expect((await screen.findByRole('status')).textContent).toBe('Device UUID copied.');expect(writeText).toHaveBeenCalledExactlyOnceWith(device.id);
 expect(screen.getByLabelText('Database Device UUID').value).toBe(device.id);expect(screen.getByText(device.hardwareId)).toBeTruthy();
});
it('does not claim copying succeeded when permission is denied and offers manual selection',async()=>{
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:vi.fn(async()=>{throw Error('permission denied');})}});
 render(<DeviceIdentity device={device}/>);fireEvent.click(screen.getByRole('button',{name:'Copy UUID'}));
 expect((await screen.findByRole('alert')).textContent).toContain('press Ctrl+C');expect(screen.queryByText('Device UUID copied.')).toBeNull();
 expect(screen.getByLabelText('Database Device UUID').selectionEnd).toBe(device.id.length);
});
it('never invents a UUID or enables copying when the backend omitted it',()=>{
 render(<DeviceIdentity device={{hardwareId:device.hardwareId}}/>);
 expect(screen.getByRole('button',{name:'Copy UUID'}).disabled).toBe(true);expect(screen.getByLabelText('Database Device UUID').value).toBe('');
});
