// Public artifact inspection only: no generated entry imports, env loading,
// Prisma construction, native execution, subprocesses or database operations.
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forwardPrismaIntegrity as reviewed } from './forward-prisma-client-integrity.js';
import { baseline } from './baseline-manifest.js';
import { adminForwardHashes } from './admin-session-forward-manifest.js';

const refuse=()=>Error('Forward Prisma Client integrity refused; details withheld');
const need=value=>{if(!value)throw refuse();};
export function verifyForwardPrismaClient() {
  try {
    const root=resolve('D:/ChildGuard-V2'),backend=resolve(root,'backend');
    need(resolve(dirname(fileURLToPath(import.meta.url)),'..')===backend);
    function read(relative,hash) {
      let current=root;
      need(!lstatSync(root).isSymbolicLink()&&realpathSync.native(root)===root);
      for(const part of relative.split('/')) {current=resolve(current,part);need(!lstatSync(current).isSymbolicLink());}
      const stat=lstatSync(current);
      need(stat.isFile()&&stat.nlink===1&&realpathSync.native(current)===current);
      const bytes=readFileSync(current);
      if(hash)need(createHash('sha256').update(bytes).digest('hex').toUpperCase()===hash);
      return bytes;
    }
    const pkg=JSON.parse(read('backend/package.json'));
    need(pkg.dependencies['@prisma/client']===reviewed.clientVersion&&pkg.devDependencies.prisma===reviewed.clientVersion);
    for(const name of ['prisma','@prisma/client','@prisma/engines'])need(JSON.parse(read('backend/node_modules/'+name+'/package.json')).version===reviewed.clientVersion);
    need(reviewed.sourceSchema===adminForwardHashes['prisma/schema.prisma']);
    read('backend/prisma/schema.prisma',reviewed.sourceSchema);
    read('backend/node_modules/@prisma/client/runtime/library.js',reviewed.runtime);
    const index=read('backend/node_modules/.prisma/client/index.js',reviewed.generatedFiles['index.js']);
    const folder=resolve(backend,'node_modules/.prisma/client');
    need(JSON.stringify(readdirSync(folder).sort())===JSON.stringify(Object.keys(reviewed.generatedFiles).sort()));
    for(const [name,hash] of Object.entries(reviewed.generatedFiles))read('backend/node_modules/.prisma/client/'+name,hash);
    const source=index.toString('utf8');
    const match=/const config = (\{[\s\S]*?\r?\n\})\s*\r?\n\s*const fs = require\('fs'\)/.exec(source);
    need(match);const config=JSON.parse(match[1]);
    need(config.clientVersion===reviewed.clientVersion&&config.engineVersion===reviewed.engineVersion&&config.activeProvider==='postgresql'&&JSON.stringify(config.datasourceNames)==='["db"]');
    need(config.generator.sourceFilePath===resolve(backend,'prisma/schema.prisma'));
    need(config.inlineDatasources.db.url.fromEnvVar==='DATABASE_URL'&&config.inlineDatasources.db.url.value===null);
    need(!config.relativeEnvPaths.rootEnvPath&&!config.relativeEnvPaths.schemaEnvPath);
    const prefix='config.runtimeDataModel = JSON.parse(';
    const line=source.split(/\r?\n/).find(l=>l.startsWith(prefix));
    need(line?.endsWith(')'));const model=JSON.parse(JSON.parse(line.slice(prefix.length,-1)));
    need(JSON.stringify(Object.keys(model.models).sort())===JSON.stringify([...baseline.tables,'AuthSession'].sort()));
    const field=(name,key)=>model.models[name]?.fields.find(f=>f.name===key);
    const version=field('User','authVersion');
    need(version?.kind==='scalar'&&version.type==='Int'&&version.isRequired===true&&version.default===0);
    for(const name of ['Center','User'])need(field(name,'authSessions')?.type==='AuthSession'&&field(name,'authSessions').isList===true);
    for(const name of ['userId','centerId','credentialHash','csrfHash'])need(field('AuthSession',name)?.type==='String'&&field('AuthSession',name).isRequired===true);
    for(const name of ['createdAt','lastActivityAt','idleExpiresAt','absoluteExpiresAt'])need(field('AuthSession',name)?.type==='DateTime'&&field('AuthSession',name).isRequired===true);
    return Object.freeze({clientVersion:config.clientVersion,models:Object.freeze(Object.keys(model.models).sort()),authVersion:true});
  } catch {throw refuse();}
}
