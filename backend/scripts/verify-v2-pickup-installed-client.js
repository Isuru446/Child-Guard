import {verifyInstalledPickupClient} from '../src/verify-pickup-installed-client.js';
try{if(process.argv.length!==2)throw Error();console.log(JSON.stringify(verifyInstalledPickupClient()));}
catch{console.error('Installed Pickup client integrity FAILED; do not start backend or bypass verification');process.exitCode=1;}
