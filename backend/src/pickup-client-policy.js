// Metadata policy for the next reviewed generation. NOT a generated-file hash approval.
// Existing baseline/Admin-session manifests remain unchanged.
import { baseline } from './baseline-manifest.js';
import { forwardPrismaIntegrity } from './forward-prisma-client-integrity.js';
import { pickupReview } from './pickup-preparation.js';
export const pickupClientPolicy=Object.freeze({
 sourceSchema:pickupReview.schema,clientVersion:'6.12.0',engineVersion:forwardPrismaIntegrity.engineVersion,
 models:Object.freeze([...baseline.tables,'AuthSession','PickupPhoto','AuthorizedPickupPerson','PickupRequest'].sort()),
 generationApproval:'REQUIRES_MAINTENANCE_AND_REVIEWED_GENERATED_FILE_HASHES',
});
export function verifyPickupClientMetadata(config,model){
 const need=value=>{if(!value)throw Error('Pickup client metadata refused');};
 need(config.clientVersion===pickupClientPolicy.clientVersion&&config.engineVersion===pickupClientPolicy.engineVersion&&config.activeProvider==='postgresql');
 need(JSON.stringify(config.datasourceNames)==='["db"]'&&config.inlineDatasources?.db?.url?.fromEnvVar==='DATABASE_URL'&&config.inlineDatasources.db.url.value===null);
 need(!config.relativeEnvPaths?.rootEnvPath&&!config.relativeEnvPaths?.schemaEnvPath);
 need(JSON.stringify(Object.keys(model.models).sort())===JSON.stringify(pickupClientPolicy.models));
 const field=(name,key)=>model.models[name]?.fields.find(field=>field.name===key);
 const scalar=(name,key,type,required=true)=>{const f=field(name,key);need(f?.kind==='scalar'&&f.type===type&&f.isRequired===required);};
 scalar('User','authVersion','Int');need(field('User','authVersion').default===0);
 for(const name of ['Center','User'])need(field(name,'authSessions')?.type==='AuthSession'&&field(name,'authSessions').isList);
 for(const key of ['userId','centerId','credentialHash','csrfHash'])scalar('AuthSession',key,'String');
 for(const key of ['createdAt','lastActivityAt','idleExpiresAt','absoluteExpiresAt'])scalar('AuthSession',key,'DateTime');
 for(const name of ['PickupPhoto','AuthorizedPickupPerson','PickupRequest'])for(const key of ['id','childId','centerId'])scalar(name,key,'String');
 scalar('PickupPhoto','bytes','Bytes');scalar('PickupPhoto','mime','String');
 for(const key of ['fullName','address','phone','photoId'])scalar('AuthorizedPickupPerson',key,'String');
 for(const key of ['personId','requestedById','photoId','day','status'])scalar('PickupRequest',key,'String');
 scalar('PickupRequest','snapshot','Json');
 for(const key of ['windowStart','windowEnd','expiresAt','createdAt'])scalar('PickupRequest',key,'DateTime');
 for(const key of ['codeHash','codeSalt','handoverHash'])scalar('PickupRequest',key,'String',false);
 for(const [name,key,type] of [['PickupPhoto','child','Child'],['AuthorizedPickupPerson','photo','PickupPhoto'],['PickupRequest','person','AuthorizedPickupPerson'],['PickupRequest','photo','PickupPhoto'],['PickupRequest','requestedBy','User'],['PickupRequest','verifiedBy','User'],['PickupRequest','reviewedBy','User']])need(field(name,key)?.kind==='object'&&field(name,key).type===type);
 return {metadataCompatible:true,models:31,generatedHashesApproved:false};
}
