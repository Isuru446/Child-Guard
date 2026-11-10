// Offline verification only. Never activates files, imports generated code, or connects to DB.
import {readFileSync,readdirSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pickupForwardClientIntegrity as pins} from './pickup-forward-client-integrity.js';
import {verifyPickupForwardClient} from './verify-pickup-forward-client.js';
const root=resolve('D:/ChildGuard-V2');
export function verifyInstalledPickupClient(){
 verifyPickupForwardClient();
 const folder=resolve(root,'backend/node_modules/.prisma/client'),files=[];
 const need=value=>{if(!value)throw Error('Installed Pickup client integrity refused');};
 const regular=path=>{need(realpathSync.native(path)===path&&!lstatSync(path).isSymbolicLink());};
 regular(root);regular(resolve(root,'backend'));regular(resolve(root,'backend/node_modules'));regular(resolve(root,'backend/node_modules/.prisma'));
 function walk(path){regular(path);for(const name of readdirSync(path)){const file=resolve(path,name);regular(file);if(lstatSync(file).isDirectory())walk(file);else{need(lstatSync(file).isFile()&&lstatSync(file).nlink===1);files.push(relative(folder,file).replaceAll('\\','/'));}}}
 walk(folder);
 need(JSON.stringify(files.sort())===JSON.stringify(Object.keys(pins.generatedFiles).sort()));
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex').toUpperCase();
 for(const [name,sha] of Object.entries(pins.generatedFiles))need(hash(resolve(folder,name))===sha);
 const require=createRequire(resolve(root,'backend/src/server.js'));
 const wrapper=resolve(root,'backend/node_modules/@prisma/client/default.js');
 regular(wrapper);
 need(require.resolve('@prisma/client')===wrapper&&hash(wrapper)==='0CFFF057C91FCB7559BD1A3BB4891404E455829CED5B18A87C9393EE1721ACE4');
 need(createRequire(wrapper).resolve('.prisma/client/default')===resolve(folder,'default.js'));
 return {installed:true,models:31,artifactFiles:files.length,hashesMatchReviewedCandidate:true,runtimeLocation:folder};
}
