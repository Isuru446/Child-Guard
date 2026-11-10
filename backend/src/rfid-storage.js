// Both schema deployment and regenerated V2 Prisma client are prerequisites.
// Legacy readers remain usable before deployment; no missing-table queries leak
// into the existing attendance path.
export async function rfidInstalled(db){
 if(!db.rfidReader||!db.rfidCard||!db.rfidEnrollment||!db.rfidScan)return false;
 const [r]=await db.$queryRaw`SELECT to_regclass('public."RfidReader"') IS NOT NULL AND to_regclass('public."RfidCard"') IS NOT NULL AND to_regclass('public."RfidEnrollment"') IS NOT NULL AND to_regclass('public."RfidScan"') IS NOT NULL AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Confirmation' AND column_name='method') AS installed`;
 return r?.installed===true;
}

export async function hydrateConfirmations(db,rows){
 if(!rows.length||!await rfidInstalled(db))return rows;
 const values=await db.confirmation.findMany({where:{attendanceId:{in:rows.map(r=>r.id)}},include:{user:{select:{id:true,username:true,role:true,centerId:true}},reader:{select:{id:true,hardwareId:true,centerId:true}}}});
 for(const row of rows)row.confirmations=values.filter(c=>c.attendanceId===row.id);
 return rows;
}
