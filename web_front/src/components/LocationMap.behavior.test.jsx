import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,act} from '@testing-library/react';
const mocks=vi.hoisted(()=>({map:vi.fn(),tile:vi.fn(),circle:vi.fn(),marker:vi.fn(),group:vi.fn(),current:null,tileError:null,resize:null}));
vi.mock('leaflet',()=>({default:{map:mocks.map,tileLayer:mocks.tile,circle:mocks.circle,circleMarker:mocks.marker,featureGroup:mocks.group}}));
import LocationMap from './LocationMap';
beforeEach(()=>{
 mocks.current={setView:vi.fn().mockReturnThis(),fitBounds:vi.fn(),getZoom:vi.fn(()=>15),removeLayer:vi.fn(),remove:vi.fn(),invalidateSize:vi.fn()};
 mocks.map.mockReturnValue(mocks.current);
 const chain=()=>({addTo:vi.fn().mockReturnThis(),bindPopup:vi.fn().mockReturnThis(),getBounds:vi.fn(()=>[[6.8,79.9]])});
 mocks.group.mockImplementation(chain);mocks.marker.mockImplementation(chain);mocks.circle.mockImplementation(chain);
 mocks.tile.mockReturnValue({addTo:vi.fn().mockReturnThis(),on:vi.fn((name,fn)=>{mocks.tileError=fn;}),redraw:vi.fn()});
 vi.stubGlobal('ResizeObserver',class{constructor(callback){mocks.resize=callback;}observe(){}disconnect(){}});
});
afterEach(()=>{cleanup();vi.clearAllMocks();vi.unstubAllGlobals();});
const point=(lat=6.8)=>({id:'child',name:'Recorded Child',lat,lng:79.9,type:'child'});
it('centers on real records, renders the circle radius in meters and preserves explored camera on updates',()=>{
 const r=render(<LocationMap preserveView locations={[point(),{id:'zone',lat:6.81,lng:79.91,radius:50,type:'geofence'}]}/>);
 expect(mocks.current.setView).toHaveBeenCalledWith([6.8,79.9],15);expect(mocks.circle).toHaveBeenCalledWith([6.81,79.91],expect.objectContaining({radius:50}));
 expect(mocks.current.fitBounds).toHaveBeenCalledTimes(1);
 r.rerender(<LocationMap preserveView locations={[point(6.9)]}/>);
 expect(mocks.current.fitBounds).toHaveBeenCalledTimes(1);expect(mocks.marker).toHaveBeenLastCalledWith([6.9,79.9],expect.any(Object));
 fireEvent.click(screen.getByRole('button',{name:'Recenter'}));expect(mocks.current.setView).toHaveBeenLastCalledWith([6.9,79.9],15);
 expect(mocks.tile).toHaveBeenCalledTimes(1);expect(mocks.tile.mock.calls[0][1].attribution).toContain('OpenStreetMap contributors');
});
it('does not initialize an unrelated example map for empty/invalid records',()=>{
 const r=render(<LocationMap locations={[]}/>);expect(mocks.map).not.toHaveBeenCalled();expect(screen.getByText('No recorded locations available.')).toBeTruthy();
 r.rerender(<LocationMap locations={[point(91)]}/>);expect(mocks.map).not.toHaveBeenCalled();
 r.rerender(<LocationMap locations={[point(0)]}/>);expect(mocks.current.setView).toHaveBeenCalledWith([0,79.9],15);
 r.unmount();expect(mocks.current.remove).toHaveBeenCalledTimes(1);
});
it('reports unavailable tiles and offers a bounded user-initiated retry',()=>{
 render(<LocationMap locations={[point()]}/>);act(()=>mocks.tileError());expect(screen.getByRole('status').textContent).toContain('Map tiles are unavailable');
 fireEvent.click(screen.getByText('Retry map tiles'));expect(mocks.tile.mock.results[0].value.redraw).toHaveBeenCalledTimes(1);
});
it('contains its control beside the canvas and preserves markers, radius and resizing',()=>{
 const view=render(<LocationMap locations={[point(),{id:'zone',lat:6.81,lng:79.91,radius:50,type:'geofence'},{id:'beacon',name:'Saved beacon',lat:6.82,lng:79.92,type:'beacon'}]}/>);
 const button=screen.getByRole('button',{name:'Recenter'}),wrapper=view.container.querySelector('.cg-location-map');
 expect(button.parentElement).toBe(wrapper);expect(screen.getByRole('region',{name:'Recorded locations map'}).parentElement).toBe(wrapper);
 expect(mocks.marker).toHaveBeenCalledTimes(3);expect(mocks.circle).toHaveBeenCalledTimes(1);
 act(()=>mocks.resize());expect(mocks.current.invalidateSize).toHaveBeenCalledTimes(1);expect(mocks.map).toHaveBeenCalledTimes(1);
 fireEvent.click(button);expect(mocks.current.setView).toHaveBeenLastCalledWith([6.8,79.9],15);
});
