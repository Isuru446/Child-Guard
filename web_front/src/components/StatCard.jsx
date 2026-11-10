import './StatCard.css';

export default function StatCard({
  title,
  value,
  icon: Icon,
  color = 'blue',
  subtitle,
  subtitleColor = 'muted',
  iconPosition = 'right',
  compact = false,
  onClick,
}) {
  const allowedColors = [
    'blue',
    'green',
    'purple',
    'orange',
    'red',
    'yellow',
  ];

  const safeColor = allowedColors.includes(color) ? color : 'blue';

  const safeSubtitleColor = ['muted', 'success', 'danger'].includes(
    subtitleColor
  )
    ? subtitleColor
    : 'muted';

  const className = [
    'cg-stat-card',
    `cg-stat-card--${safeColor}`,
    iconPosition === 'left' && 'cg-stat-card--icon-left',
    compact && 'cg-stat-card--compact',
    onClick && 'cg-stat-card--clickable',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      <div className="cg-stat-card__content">
        <span className="cg-stat-card__title">{title}</span>

        <span className="cg-stat-card__value">
          {value ?? '—'}
        </span>

        {subtitle != null && subtitle !== '' && (
          <span
            className={`cg-stat-card__subtitle cg-stat-card__subtitle--${safeSubtitleColor}`}
          >
            {subtitle}
          </span>
        )}
      </div>

      {Icon && (
        <span className="cg-stat-card__icon" aria-hidden="true">
          <Icon size={23} strokeWidth={1.8} />
        </span>
      )}
    </>
  );

  return onClick ? (
    <button
      type="button"
      className={className}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <article className={className}>{content}</article>
  );
}