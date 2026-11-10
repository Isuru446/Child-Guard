import { X } from 'lucide-react';
import { canDismissDialog } from '../hooks/useDialogAccessibility';

export default function ModalCloseButton({ onClick, disabled = false }) {
  return <button type="button" className="cg-modal-close" aria-label="Close dialog" title="Close dialog" onClick={e=>{e.stopPropagation();if(canDismissDialog(e.currentTarget.closest('[role="dialog"]')))onClick(e);}} disabled={disabled}><X size={21} aria-hidden="true" /></button>;
}
