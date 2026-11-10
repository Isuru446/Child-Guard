import {verifyPickupForwardClient} from '../src/verify-pickup-forward-client.js';
try{if(process.argv.length!==2)throw Error();console.log(JSON.stringify(verifyPickupForwardClient()));}
catch{console.error('Pickup candidate integrity FAILED; no activation or recovery performed');process.exitCode=1;}
