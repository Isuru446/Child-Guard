import {afterEach,expect,it,vi} from 'vitest';
import {render,screen,within,fireEvent,cleanup} from '@testing-library/react';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {cwd} from 'node:process';
import DataTable from './DataTable';
import ActionButton from './ActionButton';

afterEach(()=>{cleanup();document.querySelector('#table-test-styles')?.remove();});
const columns=(onClick,align)=>[
 {key:'name',label:'Account',width:'32%'},
 {key:'status',label:'Status',width:110},
 {key:'actions',label:'Actions',align,render:()=> <div className="cg-table-actions"><ActionButton onClick={onClick}>View / edit</ActionButton><ActionButton>Deactivate</ActionButton></div>},
];
it.each(['left','right'])('uses one column grid with matching %s action alignment and clickable actions',align=>{
 const click=vi.fn();render(<DataTable caption="Accounts" columns={columns(click,align)} data={[{id:'one',name:'A long account name that must remain readable',status:'Active'}]}/>);
 const table=screen.getByRole('table',{name:'Accounts'}),header=within(table).getByRole('columnheader',{name:'Actions'}),button=within(table).getByRole('button',{name:'View / edit'}),cell=button.closest('td');
 expect(header.cellIndex).toBe(cell.cellIndex);expect(header.style.textAlign).toBe(align);expect(cell.style.textAlign).toBe(align);
 expect(header.classList.contains('cg-data-table__actions')).toBe(true);expect(cell.classList.contains('cg-data-table__actions')).toBe(true);
 const cols=table.querySelectorAll('colgroup col');expect(cols).toHaveLength(3);expect(cols[0].style.width).toBe('32%');expect(cols[1].style.width).toBe('110px');expect(cols[2].style.width).toBe('1%');
 expect(table.querySelectorAll('tbody tr')[0].cells).toHaveLength(3);fireEvent.click(button);expect(click).toHaveBeenCalledTimes(1);
});
it('keeps empty and loading messages spanning the same columns inside an accessible scroll region',()=>{
 const {rerender}=render(<DataTable caption="Accounts" columns={columns()} data={[]} emptyMessage="No accounts yet."/>);
 expect(screen.getByText('No accounts yet.').colSpan).toBe(3);expect(screen.getByRole('region',{name:'Accounts'}).tabIndex).toBe(0);
 rerender(<DataTable caption="Accounts" columns={columns()} loading/>);expect(screen.getByRole('status').colSpan).toBe(3);expect(screen.getByRole('table').getAttribute('aria-busy')).toBe('true');
});
it('applies shared cell padding and intrinsic nonwrapping action groups without changing semantic table cells',()=>{
 // JSDOM can check computed CSS, but cannot establish real browser geometry.
 const style=document.createElement('style');style.id='table-test-styles';style.textContent=readFileSync(join(cwd(),'src/components/DataTable.css'),'utf8');document.head.appendChild(style);
 render(<DataTable caption="Accounts" columns={columns()} data={[{id:'one',name:'Name',status:'Active'}]}/>);
 const header=screen.getByRole('columnheader',{name:'Actions'}),cell=screen.getByRole('button',{name:'Deactivate'}).closest('td'),group=cell.querySelector('.cg-table-actions');
 expect(getComputedStyle(header).paddingLeft).toBe(getComputedStyle(cell).paddingLeft);expect(getComputedStyle(header).paddingRight).toBe(getComputedStyle(cell).paddingRight);
 expect(getComputedStyle(cell).display).toBe('table-cell');expect(getComputedStyle(group).display).toBe('inline-flex');expect(getComputedStyle(group).flexWrap).toBe('nowrap');expect(getComputedStyle(group).justifyContent).toBe('flex-start');
 expect(getComputedStyle(screen.getByRole('region',{name:'Accounts'})).overflowX).toBe('auto');
});
