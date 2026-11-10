import { preparePickupStage, verifyPickupStage, comparePickupLedger,readOwnerPickupLedger } from '../src/pickup-preparation.js';
import { resolve } from 'node:path';
try {
 if(process.cwd()!==resolve('D:/ChildGuard-V2')||process.argv.length>4)throw Error('Workspace/arguments refused');
 const result=process.argv[2]?verifyPickupStage(resolve(process.argv[2])):preparePickupStage();
 if(process.argv[3]){result.ownerLedgerComparison=comparePickupLedger(readOwnerPickupLedger(resolve(process.argv[3])));result.ownerLedgerVerified=true;}
 console.log(JSON.stringify(result,null,2));
 console.log('SOURCE STAGE ONLY: no database execution or deployment approval. Backup and current live ledger must be independently rechecked.');
}catch(error){console.error('Pickup stage refused: '+error.message);process.exitCode=1;}
