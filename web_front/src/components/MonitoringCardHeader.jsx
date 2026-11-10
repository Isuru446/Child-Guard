import {ChevronDown} from 'lucide-react';
import './MonitoringCardHeader.css';

// Native summary keeps the whole header clickable and exposes the parent
// details element's expanded state without a second React toggle state.
export default function MonitoringCardHeader({icon:Icon,title,description,count,countLabel}){
 return <summary className="monitoring-card__summary">
  <span className="monitoring-card__icon"><Icon size={21} aria-hidden="true"/></span>
  <span className="monitoring-card__heading"><span className="monitoring-card__title">{title}{count!=null&&<span className="monitoring-card__count" aria-label={countLabel}>{count}</span>}</span><span className="monitoring-card__subtitle">{description}</span></span>
  <ChevronDown className="monitoring-card__chevron" size={19} aria-hidden="true"/>
 </summary>;
}
