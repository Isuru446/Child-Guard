import { Search, X } from 'lucide-react';

import './SearchBar.css';

export default function SearchBar({
  value = '',
  onChange,
  placeholder = 'Search...',
  label = 'Search',
  className = '',
  disabled = false,
  ...inputProps
}) {
  return (
    <div
      className={[
        'cg-search',
        disabled ? 'cg-search--disabled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Search
        size={18}
        className="cg-search__icon"
        aria-hidden="true"
      />

      <input
        {...inputProps}
        type="search"
        value={value}
        onChange={(event) =>
          onChange?.(event.target.value)
        }
        placeholder={placeholder}
        aria-label={label}
        disabled={disabled}
        className="cg-search__input"
      />

      {value && !disabled && (
        <button
          type="button"
          className="cg-search__clear"
          onClick={() => onChange?.('')}
          aria-label={`Clear ${label.toLowerCase()}`}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}