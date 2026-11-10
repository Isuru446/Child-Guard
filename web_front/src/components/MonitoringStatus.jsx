import './MonitoringStatus.css';

// A permanent one-line slot: refresh, pause and error states never add height.
export default function MonitoringStatus({ read }) {
 const text=read.error
  ? `${read.error}${read.data!=null?' Showing last received data.':''}`
  : read.pausedReason==='offline' ? `Connection unavailable.${read.data!=null?' Showing last received data.':' Waiting for data.'}`
  : read.paused ? `Updates paused: ${read.pausedReason||'details open'}.`
  : read.stale ? 'Showing last received data. Waiting for an update.'
  : read.manualRefreshing ? 'Refreshing...'
  : read.updatedAt ? `Last updated: ${new Date(read.updatedAt).toLocaleString()}` : '';
 return <div className="cg-monitoring-status" data-stale={read.stale||undefined}>
  <span className="cg-monitoring-status__text" role={read.error?'alert':undefined} title={text}>{text||'\u00a0'}</span>
  {read.error&&<button type="button" onClick={read.refresh}>Retry</button>}
 </div>;
}
