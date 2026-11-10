import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { visualResponse, fixedTime } from './visual-fixtures.mjs';

const output = resolve(process.env.CG_REVIEW_OUTPUT || '../.local-tools/web-ui-review');
await mkdir(output, { recursive: true });
const profile = `${output}/browser-profile-${randomUUID()}`;
const browser = spawn(process.env.CG_REVIEW_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [...(process.env.CG_REVIEW_HEADED === '1' ? [] : ['--headless=new']), '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(process.env.CG_REVIEW_SINGLE_PROCESS === '1' ? ['--single-process'] : []), '--disable-features=SkiaGraphite', '--no-first-run', '--disable-background-networking', '--disable-component-update', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
browser.stderr.on('data', chunk => appendFileSync(`${output}/browser-start.log`,chunk));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let socket, activePage = '', nextId = 0;
const pending = new Map(), report = { fixture: 'Synthetic read-only HTTP fixtures; no live API or database access', results: [], errors: [], unmapped: [] };
try {
  let port;
  for (let n = 0; n < 100; n++) { try { port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0].trim(); await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { port = null; await sleep(250); } }
  if (!port) throw Error('Browser did not start; inspect browser-start.log');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, reject) => { socket.addEventListener('open', r, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('close', () => { for (const task of pending.values()) task.reject(Error('Browser closed before review completed')); pending.clear(); });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; const timer=setTimeout(()=>{pending.delete(id);reject(Error(`Browser command timed out: ${method}`));},15000);pending.set(id, { resolve:r=>{clearTimeout(timer);resolve(r);}, reject:e=>{clearTimeout(timer);reject(e);} }); socket.send(JSON.stringify({ id, method, params })); });
  socket.addEventListener('message', async ({ data }) => {
    try {
    const event = JSON.parse(data);
    if (event.id) { const promise = pending.get(event.id); pending.delete(event.id); if (event.error) promise?.reject(Error(event.error.message)); else promise?.resolve(event.result); return; }
    if (event.method === 'Runtime.exceptionThrown') report.errors.push({ page: activePage, message: event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text });
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') report.errors.push({ page: activePage, message: event.params.entry.text });
    if (event.method === 'Fetch.requestPaused') {
      const { requestId, request } = event.params;
      const fixture = visualResponse(request.url, request.method, activePage);
      if (fixture.unhandled) report.unmapped.push({ page: activePage, path: new URL(request.url).pathname });
      await send('Fetch.fulfillRequest', { requestId, responseCode: fixture.status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }], body: Buffer.from(JSON.stringify(fixture.body)).toString('base64') });
    }
    } catch(error) { report.errors.push({page:activePage,message:error.message}); }
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  // Every API request is intercepted before Vite can proxy it to the real backend.
  await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/*', requestStage: 'Request' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${JSON.stringify(fixedTime)}]));}static now(){return RealDate.now();}};
    window.EventSource=class{readyState=1;addEventListener(){}removeEventListener(){}close(){this.readyState=2;}};
  }` });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const screenshot = async name => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(`${output}/${name}.png`, Buffer.from(r.data, 'base64')); };
  const check = async (page, width, name = '') => {
    const metrics = await evaluate(`(()=>{const dialog=document.querySelector('[role=dialog]');return {viewport:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,title:document.querySelector('.cg-admin-content h1,h1')?.textContent,dialog:dialog?{width:dialog.getBoundingClientRect().width,left:dialog.getBoundingClientRect().left,right:dialog.getBoundingClientRect().right}:null,unstyledInputs:[...document.querySelectorAll('.cg-admin-content input:not([type=checkbox]),[role=dialog] input:not([type=checkbox])')].filter(e=>e.getClientRects().length&&getComputedStyle(e).borderRadius==='0px').length,charts:document.querySelectorAll('.cg-chart-canvas svg').length}})()`);
    report.results.push({ page, width, state: name || 'page', ...metrics });
    if (metrics.documentWidth > width + 1 || (metrics.dialog && (metrics.dialog.left < -1 || metrics.dialog.right > width + 1))) report.errors.push({ page, width, message: 'Horizontal overflow', metrics });
    await screenshot(`${page.replaceAll('/', '') || 'welcome'}-${width}${name ? '-'+name : ''}`);
  };
  const pages = ['/dashboard', '/students', '/teachers', '/parents', '/attendance', '/activity', '/alerts', '/devices', '/safe-zones', '/geofence', '/registration-approval', '/authorized-pickup', '/transport', '/login', '/'];
  for (const [width,height] of [[1440,900],[1280,800],[1024,768],[768,1024],[390,844],[320,740]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const page of pages) {
      activePage = page;
      await send('Page.navigate', { url: `${process.env.CG_REVIEW_URL || 'http://127.0.0.1:5188'}${page}` }); await sleep(page === '/dashboard' ? 1800 : 850);
      await check(page, width);
      if (page === '/dashboard') {
        const enabled = await evaluate(`JSON.stringify([...document.querySelectorAll('.dashboard-content,.dashboard-panel,.cg-stat-card')].slice(0,8).map(e=>{const s=getComputedStyle(e);return [s.fontSize,s.padding,s.borderRadius,s.backgroundColor,s.boxShadow,e.getBoundingClientRect().width]}))`);
        await evaluate(`window.reviewSheet=[...document.styleSheets].filter(s=>s.ownerNode?.getAttribute('data-vite-dev-id')?.endsWith('/AdminManagement.css'));window.reviewSheet.forEach(s=>s.disabled=true)`);
        const disabled = await evaluate(`JSON.stringify([...document.querySelectorAll('.dashboard-content,.dashboard-panel,.cg-stat-card')].slice(0,8).map(e=>{const s=getComputedStyle(e);return [s.fontSize,s.padding,s.borderRadius,s.backgroundColor,s.boxShadow,e.getBoundingClientRect().width]}))`);
        report.results.at(-1).dashboardStylesUnchanged = enabled === disabled;
        await evaluate('window.reviewSheet.forEach(s=>s.disabled=false)');
      }
      if (page === '/students' || page === '/devices' || page === '/safe-zones') {
        const label = page === '/students' ? 'Add child' : page === '/devices' ? 'Register wearable' : 'Register Beacon';
        await evaluate(`document.querySelectorAll('button').forEach(b=>{if(b.textContent.trim()===${JSON.stringify(label)})b.click()})`); await sleep(200);
        await check(page, width, 'form');
      }
      if (page === '/attendance') {
        await evaluate(`const s=[...document.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='history'));s.value='history';s.dispatchEvent(new Event('change',{bubbles:true}));`); await sleep(450);
        await check(page, width, 'history');
      }
    }
    console.log(`Reviewed ${width}px`);
  }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: report.results.length, errors: report.errors, unmapped: report.unmapped, artifact: output }));
  if (report.errors.length || report.unmapped.length || report.results.some(r => r.dashboardStylesUnchanged === false)) process.exitCode = 1;
} catch(error) {
  report.errors.push({page:activePage,message:error.message});
  await writeFile(`${output}/failure.json`,JSON.stringify(report,null,2));
  console.error(`Browser review incomplete: ${error.message}. See ${output}/browser-start.log and failure.json`);
  process.exitCode=1;
} finally { socket?.close(); browser.kill(); }
