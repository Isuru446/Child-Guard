export function latencyMark(phase,detail){
 try{if(globalThis.localStorage?.getItem('childguardLatencyDebug')==='true')globalThis.performance?.mark(phase,{detail});}catch{/* Timing is optional; unavailable storage never blocks safety reads. */}
}
