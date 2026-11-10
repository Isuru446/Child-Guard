import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import ProfilePhoto from './ProfilePhoto';
import { privatePhoto } from '../lib/api';
vi.mock('../lib/api',()=>({privatePhoto:vi.fn()}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.clearAllMocks();});

it('hides an old applicant photo immediately when identity changes and rejects late old-image responses',async()=>{
  URL.revokeObjectURL=vi.fn();let second;
  privatePhoto.mockResolvedValueOnce('blob:first').mockImplementationOnce(()=>new Promise(resolve=>{second=resolve;}));
  const {rerender}=render(<ProfilePhoto id="first" version="one"/>);
  expect((await screen.findByRole('img')).getAttribute('src')).toBe('blob:first');
  rerender(<ProfilePhoto id="second" version="one"/>);
  expect(screen.queryByRole('img')).toBeNull();expect(screen.queryByRole('link')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  rerender(<ProfilePhoto id={null}/>);
  await act(async()=>second('blob:late-second'));
  expect(screen.queryByRole('img')).toBeNull();expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late-second');
});
it('shows a placeholder when a replacement version fails instead of retaining a previous photo',async()=>{
  URL.revokeObjectURL=vi.fn();privatePhoto.mockResolvedValueOnce('blob:old').mockRejectedValueOnce(Error('Unavailable'));
  const {rerender}=render(<ProfilePhoto id="same" version="one"/>);await screen.findByRole('img');
  rerender(<ProfilePhoto id="same" version="two"/>);await act(async()=>{});
  expect(screen.queryByRole('img')).toBeNull();expect(screen.getByText('Default avatar')).toBeTruthy();
});
