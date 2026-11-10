import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=file=>readFileSync(resolve(root,file),'utf8');
const frontend=['src/main.jsx','vite.config.js','src/lib/api.js','src/pages/AdminLogin.jsx','src/components/AdminSessionGate.jsx','src/App.jsx','src/components/AdminSidebar.jsx','src/components/Topbar.jsx'];
test('reviewed cutover is integrated with the approved policy and no server-side JWT fallback on cookie rejection',()=>{
 const archive=read('V2_Planning/WP02B_ADMIN_SESSION_CUTOVER.patch');assert.equal(archive.split('diff --git a/').length-1,10);
 const server=read('backend/src/server.js');assert.match(server,/const absoluteAdminPolicy = 'OWNER_ACCEPTED_ADMIN_8H_CEILING'/);assert.ok(!server.includes('absoluteAdminPolicy = undefined'));
 assert.ok(server.indexOf('withDatabaseAdmission')<server.indexOf('prepareAdminSessionCutover({db'));
 assert.match(read('backend/src/app.js'),/if\(adminAuthRouter\) app.use\(adminAuthRouter\);\s+else/);
 assert.ok(read('web_front/src/main.jsx').includes('configureAdminCookieClient(adminClient)'));
 assert.ok(read('web_front/src/lib/api.js').includes('if(cookieClient)return cookieClient.request(path,options)'));
});
test('integrated backend syntax parses without importing or starting a server',()=>{
 for(const file of ['backend/src/app.js','backend/src/server.js'])execFileSync(process.execPath,['--input-type=module','--check'],{input:read(file),encoding:'utf8',windowsHide:true});
});
test('integrated React files pass lint with layout/classes preserved',async()=>{
 const {ESLint}=await import(pathToFileURL(resolve(root,'web_front/node_modules/eslint/lib/api.js')).href);const eslint=new ESLint({cwd:resolve(root,'web_front')});
 for(const file of frontend){const [r]=await eslint.lintText(read('web_front/'+file),{filePath:resolve(root,'web_front',file)});assert.equal(r.errorCount,0,JSON.stringify({file,rules:r.messages.map(m=>m.ruleId)}));}
 const login=read('web_front/src/pages/AdminLogin.jsx');for(const css of ['cg-auth-page admin-login-page','login-card','login-form','login-submit'])assert.ok(login.includes(css));assert.ok(login.includes("loading ? 'Signing in…' : 'Sign In'"));
});
