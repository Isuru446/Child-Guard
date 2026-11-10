// Presentation only. Never use these labels as API values or filter identities.
export const approvalLabel = value => ({PENDING:'Waiting for approval',APPROVED:'Approved',REJECTED:'Rejected'})[value] || value || 'Not recorded';
export const pickupLabel = value => ({PENDING:'Waiting for pickup',COMPLETED:'Completed',CANCELLED:'Cancelled',EXPIRED:'Expired',REJECTED:'Rejected'})[value] || value || 'Not recorded';
export const proximityLabel = value => ({NEAR:'Nearby (NEAR)',FAR:'Far away (FAR)',UNKNOWN:'Signal not available (UNKNOWN)'})[value] || 'Signal not available (UNKNOWN)';
export const eventLabel = value => ({TAMPER_LOOP_OPEN:'Wearable tamper detected',TAMPER_LOOP_RESTORED:'Tamper loop reconnected',TAMPER_LOOP_STATUS:'Tamper loop status',WEARABLE_CONNECTION_LOST:'Wearable Connection Lost',DANGER_ZONE_NEAR:'Danger-zone alert',DANGER_ZONE_EXIT:'Left danger zone',GEOFENCE_OUTSIDE:'Child outside safe area',BEACON_SIGNAL_LOST:'Beacon signal lost',BLE_PROXIMITY:'Bluetooth proximity update',CHILD_NEAR_GATE:'Gate arrival',GPS_STATUS:'GPS update',ACTIVITY_SUMMARY:'Movement summary',ACTIVITY_WINDOW:'Movement readings',ACTIVITY_SAMPLE_GAP:'Missing movement readings',LOW_ACTIVITY:'Low movement detected',LOW_ACTIVITY_ADVISORY:'Low movement detected'})[value] || value || 'Not recorded';
export const deviceUpdateLabel = value => value==='DANGER_ZONE_NEAR'?'Danger-zone approach report':value==='DANGER_ZONE_EXIT'?'Danger-zone departure report':eventLabel(value);
export const activityLabel = value => ({NORMAL:'No sustained movement reduction',LOW_ACTIVITY:'Low movement detected',LOW_ACTIVITY_ADVISORY:'Low movement advisory',BELOW_BASELINE_CANDIDATE:'Movement below baseline for one period',BASELINE_LEARNING:'Learning usual movement',INSUFFICIENT_DATA:'Not enough readings',SENSOR_UNAVAILABLE:'Movement sensor unavailable',NOT_MONITORING:'Monitoring paused'})[value] || value || 'Not recorded';
export function requestMessage(error) {
 if(error.status===401)return 'Your session has ended. Please sign in again.';
 if(error.status===403)return 'You do not have permission to perform this action.';
 if(error.status===429)return 'Too many attempts. Please wait a minute and try again.';
 if(error.status>=500)return 'ChildGuard is temporarily unavailable. Please try again.';
 if(error.code==='NETWORK_ERROR')return 'Cannot connect to ChildGuard. Check your connection and try again.';
 return error.message || 'This action could not be completed. Please try again.';
}
