import {
  Edit,
  Trash2,
  Plus,
  MapPin,
  MapPinned,
} from 'lucide-react';

import './ActionButton.css';

const defaultIcons = {
  edit: Edit,
  delete: Trash2,
  add: Plus,
  location: MapPin,
  viewAll: MapPinned,
};

const defaultLabels = {
  edit: 'Edit',
  delete: 'Delete',
  add: 'Add New',
  location: 'Location',
  viewAll: 'View All on Map',
  primary: 'Save',
  secondary: 'Cancel',
};

export default function ActionButton({
  variant = 'primary',
  children,
  icon,
  showIcon = true,
  size = 'normal',
  type = 'button',
  className = '',
  disabled = false,
  ...props
}) {
  const Icon = icon || defaultIcons[variant];

  const classes = [
    'cg-action-button',
    `cg-action-button--${variant}`,
    size === 'small' ? 'cg-action-button--small' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...props}
      type={type}
      className={classes}
      disabled={disabled}
    >
      {showIcon && Icon && (
        <Icon
          size={size === 'small' ? 14 : 17}
          aria-hidden="true"
        />
      )}

      <span>{children ?? defaultLabels[variant]}</span>
    </button>
  );
}