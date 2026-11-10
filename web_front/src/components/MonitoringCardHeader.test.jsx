import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LiveDevices from './LiveDevices';
import {api} from '../lib/api';
vi.mock('../lib/api',()=>({api:vi.fn()}));
vi.mock('./Topbar',()=>({default:()=>null}));
vi.mock('./Footer',()=>({default:()=>null}));
let devices;
const now=Date.parse('2026-10-29T08:00:00Z');
const makeDevice=(id)=>({id,hardwareId:`SYNTHETIC-${id}`,active:true,lastSeen:new Date(now).toISOString(),currentAssignment:null,monitoring:{serverTime:new Date(now).toISOString()},gpsMonitoring:{latestStatus:'GPS_NO_FIX'},beaconStates:[{beaconId:`beacon-${id}`,name:`Beacon for ${id}`,kind:'GATE',proximity:'FAR',rssi:-70,observedAt:new Date(now).toISOString()}]});
const tick=ms=>act(async()=>{await vi.advanceTimersByTimeAsync(ms);});
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(now);vi.spyOn(document,'hidden','get').mockReturnValue(false);vi.spyOn(navigator,'onLine','get').mockReturnValue(true);
 devices=[makeDevice('one'),makeDevice('two')];api.mockReset().mockImplementation(async path=>path.startsWith('/api/v1/devices?')?structuredClone(devices):[]);
});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
const mount=()=>render(<MemoryRouter><LiveDevices/></MemoryRouter>);
it('uses the same native card header for each device panel and the RFID reference',async()=>{
 const view=mount();await tick(250);const cards=[...view.container.querySelectorAll('details.monitoring-card')];expect(cards).toHaveLength(5);
 expect(cards.slice(0,4).map(card=>card.querySelector('summary .monitoring-card__title').textContent)).toEqual([
  'SYNTHETIC-one - Location, movement and Bluetooth readings','SYNTHETIC-two - Location, movement and Bluetooth readings',
  'SYNTHETIC-one - Bluetooth beacon readings','SYNTHETIC-two - Bluetooth beacon readings',
 ]);
 for(const card of cards){expect(card.firstElementChild.tagName).toBe('SUMMARY');expect(card.querySelector('.monitoring-card__icon svg')).toBeTruthy();expect(card.querySelector('.monitoring-card__chevron')).toBeTruthy();expect(card.querySelector('.monitoring-card__subtitle')).toBeTruthy();}
 expect(cards[0].querySelector('.lucide-activity')).toBeTruthy();expect(cards[2].querySelector('.lucide-bluetooth')).toBeTruthy();expect(cards[4].querySelector('.lucide-radio')).toBeTruthy();
 expect(within(cards[0]).getByText('View location, movement and Bluetooth proximity data.')).toBeTruthy();
 expect(within(cards[2]).getByText('View recent Bluetooth beacon observations and signal readings.')).toBeTruthy();
 expect(cards.slice(0,4).some(card=>card.querySelector('.monitoring-card__count'))).toBe(false);
 expect(api.mock.calls.some(([path])=>path.includes('/rfid/readers'))).toBe(false);
});
it('keeps independent disclosure state and device-scoped data through refresh and a new device',async()=>{
 const view=mount();await tick(250);const telemetry=view.container.querySelectorAll('.dv-telemetry-details'),beacons=view.container.querySelectorAll('.dv-beacon-details');
 telemetry[0].open=true;beacons[1].open=true;fireEvent(telemetry[0],new Event('toggle'));fireEvent(beacons[1],new Event('toggle'));
 expect(telemetry[1].open).toBe(false);expect(beacons[0].open).toBe(false);
 expect(within(beacons[1]).getByText('Beacon for two')).toBeTruthy();expect(within(beacons[1]).queryByText('Beacon for one')).toBeNull();
 devices.push(makeDevice('three'));fireEvent.click(screen.getByRole('button',{name:'Refresh'}));await tick(0);
 expect(view.container.querySelectorAll('details.monitoring-card')).toHaveLength(7);
 expect(view.container.querySelectorAll('.dv-telemetry-details')[0]).toBe(telemetry[0]);expect(telemetry[0].open).toBe(true);expect(beacons[1].open).toBe(true);
 expect(screen.getByText('SYNTHETIC-three - Location, movement and Bluetooth readings')).toBeTruthy();
 expect(screen.getByText('SYNTHETIC-three - Bluetooth beacon readings')).toBeTruthy();
 telemetry[0].open=false;expect(telemetry[0].open).toBe(false);expect(beacons[1].open).toBe(true);
});
