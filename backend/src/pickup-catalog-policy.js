// Reviewed catalog policy. SQL is checked against its frozen migration checksum.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pickupReview} from './pickup-preparation.js';
const normalize=text=>text.replaceAll('"','').replace(/\s+/g,' ').trim();
export function verifyPickupCatalog(evidence){
 const need=(value,check)=>{if(!value)throw Error('Pickup catalog refused: '+check);};
 const sql=readFileSync('D:/ChildGuard-V2/backend/prisma/migrations/202610260001_authorized_pickup/migration.sql','utf8');
 need(createHash('sha256').update(sql).digest('hex').toUpperCase()===pickupReview.sql,'source checksum');
 const names=['PickupPhoto','AuthorizedPickupPerson','PickupRequest'];
 need(evidence.tables.length===3&&new Set(evidence.tables.map(t=>t.relname)).size===3,'table inventory');
 for(const name of names){const table=evidence.tables.find(t=>t.relname===name);need(table?.owner==='childguard_v2_migrator'&&table.read&&table.insert&&!table.excess&&table.update===(name!=='PickupPhoto'),'ownership/privileges');}
 const expected=new Map();
 const add=(table,name,type,definition)=>expected.set(table+'/'+name,{type,definition:normalize(definition)});
 for(const name of names)add(name,name+'_pkey','p','PRIMARY KEY (id)');
 for(const m of sql.matchAll(/ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" FOREIGN KEY \("(\w+)"\) REFERENCES "(\w+)"\("id"\) ON DELETE RESTRICT ON UPDATE CASCADE/g))add(m[1],m[2],'f',`FOREIGN KEY (${m[3]}) REFERENCES ${m[4]}(id) ON UPDATE CASCADE ON DELETE RESTRICT`);
 const checks={
  PickupPhoto_size:'CHECK (octet_length(bytes) >= 24 AND octet_length(bytes) <= 2097152)',
  PickupRequest_attempts:'CHECK (attempts >= 0 AND attempts <= 5 AND codeIssues >= 1 AND codeIssues <= 3)',
  PickupRequest_completion:"CHECK (status <> 'COMPLETED'::text OR completedAt IS NOT NULL AND reviewedById IS NOT NULL AND verifiedById IS NOT NULL AND verifiedById = reviewedById)",
  PickupRequest_state:"CHECK (status = ANY (ARRAY['PENDING'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'EXPIRED'::text, 'REJECTED'::text]))",
  PickupRequest_window:'CHECK (windowEnd > windowStart AND expiresAt <= windowEnd)',
 };
 for(const [name,definition] of Object.entries(checks))add(name.startsWith('PickupPhoto')?'PickupPhoto':'PickupRequest',name,'c',definition);
 need(expected.size===22,'reviewed constraint inventory');
 const required=new Map();
 for(const m of sql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\r?\n\);/g))for(const field of m[2].matchAll(/^\s*"(\w+)"[^\r\n]*NOT NULL/gm))required.set(m[1]+'/'+normalize('NOT NULL '+field[1]),true);
 need(required.size===33,'reviewed not-null inventory');
 for(const k of evidence.constraints){
  need(k.convalidated&&!k.condeferrable,'constraint validity');
  if(k.type==='n'){need(required.delete(k.relname+'/'+normalize(k.definition)),'not-null definition');continue;}
  const key=k.relname+'/'+k.conname,want=expected.get(key);
  need(want?.type===k.type&&want.definition===normalize(k.definition),'constraint definition '+key);expected.delete(key);
 }
 need(!expected.size&&!required.size&&evidence.constraints.length===55,'complete constraints');
 const indexes=new Map();
 for(const name of names)indexes.set(name+'_pkey',normalize(`CREATE UNIQUE INDEX ${name}_pkey ON public.${name} USING btree (id)`));
 for(const m of sql.matchAll(/CREATE INDEX "(\w+)" ON "(\w+)"\(([^;]+)\);/g))indexes.set(m[1],normalize(`CREATE INDEX ${m[1]} ON public.${m[2]} USING btree (${m[3]})`));
 for(const [name,status] of [['PickupRequest_one_pending','PENDING'],['PickupRequest_one_completion','COMPLETED']])indexes.set(name,`CREATE UNIQUE INDEX ${name} ON public.PickupRequest USING btree (childId, day) WHERE (status = '${status}'::text)`);
 for(const i of evidence.indexes){need(i.indisvalid&&i.indisready&&indexes.get(i.name)===normalize(i.definition),'index definition '+i.name);indexes.delete(i.name);}
 need(!indexes.size&&evidence.indexes.length===9,'complete indexes');
 const ownerPrivileges=['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
 const expectedGrants=new Set();
 for(const name of names){for(const p of ownerPrivileges)expectedGrants.add(name+'/childguard_v2_migrator/'+p);for(const p of name==='PickupPhoto'?['SELECT','INSERT']:['SELECT','INSERT','UPDATE'])expectedGrants.add(name+'/childguard_v2_app/'+p);}
 for(const g of evidence.grants)need(!g.is_grantable&&expectedGrants.delete(g.relname+'/'+g.grantee+'/'+g.privilege_type),'unexpected grant');
 need(!expectedGrants.size&&!evidence.columnGrants.length&&!evidence.ledgerReadable,'grant completeness/history isolation');
 return {catalogPassed:true,tables:3,nonNotNullConstraints:22,notNullConstraints:33,indexes:9,definitionsAndPrivilegesMatchReviewedSql:true};
}
