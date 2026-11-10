import { useId } from 'react';

import './FilterOption.css';

export default function FilterOption({
  label = 'Filter',
  value,
  onChange,
  options = [],
  mode = 'select',
  showLabel = false,
  disabled = false,
  className = '',
}) {
  const id = useId();

  if (mode === 'tabs') {
    return (
      <div
        className={`cg-filter-tabs ${className}`}
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            className={
              `cg-filter-tabs__button ${
                value === option.value
                  ? 'cg-filter-tabs__button--active'
                  : ''
              }`
            }
            aria-pressed={value === option.value}
            disabled={disabled || option.disabled}
            onClick={() => onChange?.(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`cg-filter-select ${className}`}>
      <label
        htmlFor={id}
        className={
          showLabel
            ? 'cg-filter-select__label'
            : 'cg-filter-select__label--hidden'
        }
      >
        {label}
      </label>

      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onChange?.(event.target.value)
        }
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}