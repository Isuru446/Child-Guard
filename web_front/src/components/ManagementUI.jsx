export function PageHeading({ title, children, actions }) {
  return <header className="cg-page-heading"><div><h1>{title}</h1>{children && <p>{children}</p>}</div>{actions && <div className="cg-page-actions">{actions}</div>}</header>;
}

export function Panel({ title, description, children, actions, className = '' }) {
  return <section className={`cg-panel ${className}`}><div className="cg-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="cg-page-actions">{actions}</div>}</div>{children}</section>;
}

export function StatusPill({ children, tone = 'info' }) {
  return <span className={`cg-status cg-status--${tone}`}>{children}</span>;
}

export function DemoNotice() {
  return <p role="note" className="cg-demo-notice">Example data only: changes stay in this browser and do not update real center records or authorize a pickup. Map previews are not live tracking.</p>;
}
