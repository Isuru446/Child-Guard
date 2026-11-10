// Test child only: reject dotenv reads and JS network connections during validation.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const read=fs.readFileSync;
fs.readFileSync=function(file,...args){if(typeof file==='string'&&/^\.env(?:\.|$)/i.test(path.basename(file)))throw Error('Offline validation refused environment read');return read.call(this,file,...args);};
net.connect=net.createConnection=()=>{throw Error('Offline validation refused network');};
