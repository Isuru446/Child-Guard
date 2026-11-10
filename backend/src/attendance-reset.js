// Existing AuditLog is the durable reset generation and immutable confirmation archive.
export const RESET_ACTION = 'ATTENDANCE_DEV_RESET';
export const ABSENCE_CORRECTION = 'ATTENDANCE_ABSENCE_CORRECTED';
export const resetEnabled = (env, flag) => ['development','test'].includes(env) && flag === 'true';
export const latestReset = (db, id) => db.auditLog.findFirst({where:{resourceId:id,action:{in:[RESET_ACTION,ABSENCE_CORRECTION]}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
