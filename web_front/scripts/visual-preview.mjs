// Loopback-only rendered preview. No proxy, credentials, database or live API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { visualResponse, fixedTime } from './visual-fixtures.mjs';

const root=resolve('dist'),port=5190;
const routes=['dashboard','students','teachers','parents','attendance','activity','alerts','devices','safe-zones','geofence','registration-approval','authorized-pickup','transport'];
const bootstrap=`<script>{const RealDate=Date,start=RealDate.now(),base=RealDate.parse(${JSON.stringify(fixedTime)});window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[base+RealDate.now()-start]));}static now(){return base+RealDate.now()-start;}};window.EventSource=class{readyState=1;addEventListener(){}removeEventListener(){}close(){this.readyState=2;}};}</script>`;
const banner='<div style="position:fixed;bottom:8px;right:8px;z-index:10000;max-width:90vw;padding:7px 12px;border-radius:6px;background:#fff2d7;color:#81530d;font:12px sans-serif;box-shadow:0 2px 10px #0002">Synthetic read-only UI preview · no live data · <a href="/__review">pages</a></div>';
const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://127.0.0.1:${port}`);
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  if(url.pathname.startsWith('/api/')){
    const page=new URL(req.headers.referer||'/dashboard',url.origin).pathname;
    const result=visualResponse(url.href,req.method,page);
    res.writeHead(result.status,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));return;
  }
  if(req.method!=='GET'){res.writeHead(405);res.end('Read-only preview');return;}
  if(url.pathname==='/__review'){
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<h1>ChildGuard synthetic visual review</h1><p>No backend connection. Business mutations are rejected. Do not enter real credentials.</p><ul>${routes.map(route=>`<li><a href="/${route}">${route}</a></li>`).join('')}</ul>`);return;
  }
  try{
    const asset=extname(url.pathname)!=='';
    const file=asset?resolve(root,'.'+decodeURIComponent(url.pathname)):resolve(root,'index.html');
    if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    let content=await readFile(file);
    if(!asset)content=content.toString().replace('<head>','<head>'+bootstrap).replace('</body>',banner+'</body>');
    res.writeHead(200,{'Content-Type':asset?(types[extname(file)]||'application/octet-stream'):'text/html; charset=utf-8'});res.end(content);
  }catch{res.writeHead(404);res.end('Build frontend first: npm.cmd run build');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Read-only visual fixtures: http://127.0.0.1:${port}/__review (Ctrl+C to stop)`));
