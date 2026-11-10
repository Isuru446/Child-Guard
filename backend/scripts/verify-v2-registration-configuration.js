// Approved environment loader; output only non-secret registration switches.
import {loadDevelopmentEnvironment} from '../src/development-environment.js';
try{
 const env=loadDevelopmentEnvironment();
 console.log(JSON.stringify({environment:env.NODE_ENV,registrationEnabled:env.ENABLE_REGISTRATION==='true',publicCenterCount:(env.PUBLIC_REGISTRATION_CENTER_IDS||'').split(',').filter(s=>s.trim()).length}));
}catch{console.error('Registration configuration inspection refused; details withheld');process.exitCode=1;}
