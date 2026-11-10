export default function TechnicalDetails({ children, title = 'Technical details' }) {
  return <details className="cg-technical" onInvalidCapture={event=>{event.currentTarget.open=true;}}><summary>{title}</summary><div className="cg-technical__body">{children}</div></details>;
}
