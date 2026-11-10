// Read-only forward checks. Never imports a CLI, creates a client or executes DDL.
import { readBaselineSnapshot, validateBaselineSnapshot, validateBaselineLedger } from './baseline-verification.js';
import { assertMigrationIdentity } from './migration-admission.js';
import { expressionTree } from './baseline-expression.js';

export const sessionMigrationName='202610250001_admin_session_foundation';
const owner='childguard_v2_migrator';
const refuse=()=>Error('V2 Admin forward verification refused; details withheld');
const need=v=>{if(!v)throw refuse();};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function validateForwardLedger(rows,phase,newChecksum) {
  need(['before','after'].includes(phase));
  const additional=rows.filter(r=>r.name===sessionMigrationName);
  validateBaselineLedger(rows.filter(r=>r.name!==sessionMigrationName));
  need(additional.length===(phase==='after'?1:0));
  if (phase==='after') {const r=additional[0];need(r.finished===true&&r.notRolledBack===true&&r.steps===1&&r.checksum.toUpperCase()===newChecksum);}
}
function checkExpression(value) {
  // Only the two reviewed interval constants, with PostgreSQL's normal deparse.
  // Unknown interval styles fail closed pending real catalog acceptance.
  return expressionTree(value.replace(/INTERVAL '300 seconds'|'00:05:00'::interval/gi,"'SESSION_INTERVAL_300'")
    .replace(/INTERVAL '8 hours'|'08:00:00'::interval/gi,"'SESSION_INTERVAL_28800'"));
}
const checks={
  AuthSession_admin_only:'"clientKind" = \'ADMIN_WEB\' AND "roleAtLogin" = \'ADMIN\'',
  AuthSession_versions:'"authVersion" >= 0 AND "revision" >= 0',
  AuthSession_hashes:'"credentialHash" ~ \'^[a-f0-9]{64}$\' AND "csrfHash" ~ \'^[a-f0-9]{64}$\'',
  AuthSession_time_order:'"createdAt" <= "lastActivityAt" AND "lastActivityAt" < "idleExpiresAt" AND "idleExpiresAt" <= "absoluteExpiresAt"',
  AuthSession_idle_limit:'"idleExpiresAt" <= "lastActivityAt" + INTERVAL \'300 seconds\'',
  AuthSession_absolute_limit:'"absoluteExpiresAt" <= "createdAt" + INTERVAL \'8 hours\'',
};
export function validateForwardSnapshot(snapshot,phase,functionSource) {
  if(phase==='before') {validateBaselineSnapshot(snapshot);return;}
  need(phase==='after');
  const s=structuredClone(snapshot);
  const tables=s.tables.filter(t=>t.name==='AuthSession');
  need(tables.length===1&&tables[0].owner===owner&&tables[0].kind==='r'&&!tables[0].rls&&!tables[0].forcedRls);
  const types=s.types.filter(t=>['AuthSession','_AuthSession'].includes(t.name));
  need(types.length===2&&types.every(t=>t.owner===owner&&(t.name==='AuthSession'?t.kind==='c'&&t.element===null:t.kind==='b'&&t.element==='AuthSession')));
  const constraints=s.constraints.filter(c=>c.table==='AuthSession'||(c.table==='User'&&c.name==='User_authVersion_nonnegative'));
  need(constraints.length===10);
  for(const c of constraints) {
    need(c.validated===true&&c.enforced===true&&c.deferrable===false&&c.deferred===false);
    if(c.type==='c') {
      const expected=c.name==='User_authVersion_nonnegative'?'"authVersion" >= 0':checks[c.name];
      need(expected&&c.noInherit===false&&same(checkExpression(c.expression),checkExpression(expected)));
    } else if(c.name==='AuthSession_pkey') need(c.type==='p'&&same(c.columns,['id']));
    else {const reference=c.name==='AuthSession_userId_fkey'?'User':c.name==='AuthSession_centerId_fkey'?'Center':null;
      need(reference&&c.type==='f'&&c.referenceSchema==='public'&&c.reference===reference&&same(c.columns,[reference==='User'?'userId':'centerId'])&&same(c.referenceColumns,['id'])&&c.delete==='r'&&c.update==='r'&&c.match==='s');}
  }
  need(new Set(constraints.map(c=>c.name)).size===10);
  const expectedIndexes={AuthSession_pkey:['id'],AuthSession_credentialHash_key:['credentialHash'],AuthSession_userId_revokedAt_idx:['userId','revokedAt'],AuthSession_absoluteExpiresAt_idx:['absoluteExpiresAt'],AuthSession_idleExpiresAt_idx:['idleExpiresAt'],AuthSession_centerId_idx:['centerId']};
  const indexes=s.indexes.filter(i=>i.table==='AuthSession');
  need(indexes.length===6&&new Set(indexes.map(i=>i.name)).size===6);
  for(const i of indexes)need(expectedIndexes[i.name]&&same(i.columns,expectedIndexes[i.name])&&i.owner===owner&&i.method==='btree'&&i.valid&&i.ready&&i.live&&!i.expressions&&!i.nullsNotDistinct&&i.predicate===null&&i.unique===['AuthSession_pkey','AuthSession_credentialHash_key'].includes(i.name)&&i.keys===i.columns.length&&same(i.options,i.columns.map(()=>0)));
  const functions=s.functions.filter(f=>f.name==='childguard_invalidate_admin_sessions');
  need(functions.length===1);const f=functions[0];
  need(f.owner===owner&&f.language==='plpgsql'&&f.returnType==='trigger'&&f.arguments===0&&f.kind==='f'&&!f.securityDefiner&&f.volatility==='v'&&!f.strict&&same(f.config,['search_path=pg_catalog, public'])&&f.source.replaceAll('\r\n','\n').trim()===functionSource.trim());
  const triggers=s.triggers.filter(t=>t.name==='User_invalidate_admin_sessions');need(triggers.length===1);const t=triggers[0];
  need(t.table==='User'&&t.functionSchema==='public'&&t.function===f.name&&t.type===19&&t.enabled==='O'&&t.arguments===0&&t.condition===null&&same([...t.columns].sort((a,b)=>a-b),[3,4,5,6,7])&&!t.constraint&&t.oldTransition===null&&t.newTransition===null);
  s.tables=s.tables.filter(t=>t.name!=='AuthSession');s.types=s.types.filter(t=>!['AuthSession','_AuthSession'].includes(t.name));
  s.constraints=s.constraints.filter(c=>!constraints.includes(c));s.indexes=s.indexes.filter(i=>i.table!=='AuthSession');
  s.functions=s.functions.filter(f=>f.name!=='childguard_invalidate_admin_sessions');s.triggers=s.triggers.filter(t=>t.name!=='User_invalidate_admin_sessions');
  validateBaselineSnapshot(s); // Preserve every original baseline object check.
}
export async function inspectAdminForwardMigration(db,{phase,checksum,functionSource,before}) {
  try {
    need(['before','after'].includes(phase));
    await assertMigrationIdentity(db,'development');
    validateForwardSnapshot(await readBaselineSnapshot(db),phase,functionSource);
    const ledger=await db.$queryRaw`SELECT migration_name AS name,checksum,finished_at IS NOT NULL AS finished,
      rolled_back_at IS NULL AS "notRolledBack",applied_steps_count AS steps FROM public._prisma_migrations ORDER BY migration_name`;
    validateForwardLedger(ledger,phase,checksum);
    const rows=await db.$queryRaw`SELECT
      (SELECT count(*)::int FROM public."User") AS users,
      (SELECT count(*)::int FROM public."User" WHERE role='ADMIN' AND active) AS admins,
      (SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(id,username,"passwordHash",role,active,"centerId") ORDER BY id),'[]'::jsonb)::text) FROM public."User") AS "usersFingerprint",
      (SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(id,name) ORDER BY id),'[]'::jsonb)::text) FROM public."Center") AS "centersFingerprint",
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='User' AND column_name='authVersion') AS version`;
    need(rows.length===1);const r=rows[0];
    need(Number.isInteger(r.users)&&r.users>0&&Number.isInteger(r.admins)&&r.admins>0&&/^[a-f0-9]{32}$/.test(r.usersFingerprint)&&/^[a-f0-9]{32}$/.test(r.centersFingerprint)&&r.version===(phase==='after'));
    if(phase==='after') {
      need(before&&['users','admins','usersFingerprint','centersFingerprint'].every(k=>before[k]===r[k]));
      const [p]=await db.$queryRaw`SELECT
        (SELECT count(*)::int FROM public."AuthSession") AS sessions,
        (SELECT count(*)::int FROM public."User" WHERE "authVersion"<>0) AS changed,
        has_table_privilege('childguard_v2_app','public."AuthSession"','SELECT') AND has_table_privilege('childguard_v2_app','public."AuthSession"','INSERT') AND has_table_privilege('childguard_v2_app','public."AuthSession"','UPDATE') AS dml,
        has_table_privilege('childguard_v2_app','public."AuthSession"','DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AS excessive,
        has_function_privilege('childguard_v2_app','public.childguard_invalidate_admin_sessions()','EXECUTE') AS execute,
        EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
          LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE n.nspname='public' AND p.proname='childguard_invalidate_admin_sessions'
          AND a.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='childguard_v2_app'))) AS "otherFunctionAcl",
        EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
          LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
          WHERE n.nspname='public' AND c.relname='AuthSession'
          AND a.grantee NOT IN (c.relowner,(SELECT oid FROM pg_roles WHERE rolname='childguard_v2_app'))) AS "otherTableAcl",
        EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
          LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE n.nspname='public' AND p.proname='childguard_invalidate_admin_sessions' AND a.grantee=0 AND a.privilege_type='EXECUTE') AS "publicExecute"`;
      need(p&&p.sessions===0&&p.changed===0&&p.dml===true&&p.excessive===false&&p.execute===true&&p.publicExecute===false&&p.otherTableAcl===false&&p.otherFunctionAcl===false);
      const columns=await db.$queryRaw`SELECT c.relname AS "table",a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS "default"
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
        AND (c.relname='AuthSession' OR (c.relname='User' AND a.attname='authVersion'))`;
      validateForwardColumns(columns);
    }
    return Object.freeze({...r}); // Private in-memory preservation evidence, never a bearer or approval.
  } catch {throw refuse();}
}
export function validateForwardColumns(columns) {
  const time='timestamp(3) with time zone';
  const expected={id:['text',true,null],userId:['text',true,null],centerId:['text',true,null],
    clientKind:['text',true,"'ADMIN_WEB'::text"],roleAtLogin:['"Role"',true,"'ADMIN'::\"Role\""],authVersion:['integer',true,null],
    credentialHash:['character(64)',true,null],csrfHash:['character(64)',true,null],createdAt:[time,true,'CURRENT_TIMESTAMP'],
    absoluteExpiresAt:[time,true,null],lastActivityAt:[time,true,null],idleExpiresAt:[time,true,null],revokedAt:[time,false,null],
    revokeReason:['text',false,null],lastInteractionId:['text',false,null],revision:['integer',true,'0']};
  need(columns.length===17&&new Set(columns.map(c=>c.table+'.'+c.name)).size===17);
  for(const c of columns) {const e=c.table==='User'&&c.name==='authVersion'?['integer',true,'0']:c.table==='AuthSession'?expected[c.name]:null;need(e&&same([c.type,c.required,c.default],e));}
}
