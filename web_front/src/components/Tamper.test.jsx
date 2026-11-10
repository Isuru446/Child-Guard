import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import TamperStatus from './TamperStatus';
import {eventLabel} from '../lib/ui-language';
import {createDangerNotifications} from '../lib/danger-notifications';
afterEach(()=>{cleanup();vi.useRealTimers();});
const now=Date.parse('2026-10-28T10:00:00Z');
const status=state=>({state,lastKnownState:state,stale:false,observedAt:new Date(now).toISOString(),transitionAt:new Date(now-20000).toISOString(),staleAfterMs:60000});
it('disconnected is explicitly labelled and red; closed uses the existing normal badge',()=>{
 const view=render(<TamperStatus now={now} tamper={status('OPEN')}/>);
 expect(screen.getByText('Tamper loop: Disconnected').className).toContain('dv-badge--danger');
 view.rerender(<TamperStatus now={now} tamper={status('CLOSED')}/>);
 expect(screen.getByText('Tamper loop: Connected').className).toContain('dv-badge--success');
});
it('stale or failed reads never present closed as currently connected',()=>{
 const view=render(<TamperStatus now={now+61000} tamper={status('CLOSED')}/>);
 expect(screen.getByText('Tamper loop: Unavailable')).toBeTruthy();expect(screen.getByText(/Last known: Connected/)).toBeTruthy();
 view.rerender(<TamperStatus now={now} unavailable tamper={status('CLOSED')}/>);
 expect(screen.getByText('Tamper loop: Unavailable')).toBeTruthy();
});
it('missing firmware evidence remains unavailable',()=>{
 render(<TamperStatus now={now}/>);expect(screen.getByText('Tamper loop: Unavailable')).toBeTruthy();
});
it('tamper participates once in the existing danger notifier and restoration is not danger',()=>{
 const tracker=createDangerNotifications();tracker.read([]);
 const row={id:'saved-tamper',kind:'TAMPER_LOOP_OPEN'};
 expect(tracker.read([row])).toHaveLength(1);expect(tracker.read([row])).toHaveLength(0);
 expect(tracker.read([{id:'restore',kind:'TAMPER_LOOP_RESTORED'}])).toHaveLength(0);
 expect(eventLabel(row.kind)).toBe('Wearable tamper detected');expect(eventLabel('TAMPER_LOOP_RESTORED')).toBe('Tamper loop reconnected');
});
