// Prisma adapter. Lock order everywhere: User -> AuthSession. DB clock is read
// after lock acquisition; READ COMMITTED sees changes committed while waiting.
import { SessionError } from './admin-session-service.js';
export function adminSessionRepository(db) {
  const transaction = (work, isolationLevel = 'ReadCommitted') => {
    if (!['ReadCommitted','Serializable'].includes(isolationLevel)) throw new SessionError('SERVICE_UNAVAILABLE',503);
    return db.$transaction(work, {isolationLevel, maxWait:5000, timeout:10000});
  };
  async function lockUser(tx, id) {
    await tx.$queryRaw`SELECT "id" FROM public."User" WHERE "id" = ${id} FOR UPDATE`;
    return tx.user.findUnique({where:{id}});
  }
  function context(tx, user, session = null) {
    return {
      db:tx, user, session,
      async now() {
        const rows = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        if (rows.length !== 1 || !(rows[0].now instanceof Date) || !Number.isFinite(+rows[0].now)) throw Error();
        return rows[0].now;
      },
      insert: data => tx.authSession.create({data}),
      audit: (action, resourceId) => tx.auditLog.create({data:{userId:user.id, action, resourceId}}),
      async refresh() {
        this.user = await tx.user.findUnique({where:{id:user.id}});
        session = await tx.authSession.findUnique({where:{id:session.id}});
        this.session = session;
      },
      async update(data) {
        let rows;
        if (data.revokeReason === 'LOGOUT') {
          rows = await tx.$queryRaw`UPDATE public."AuthSession" SET "revokedAt" = clock_timestamp(),
            "revokeReason" = 'LOGOUT', "revision" = "revision" + 1
            WHERE "id" = ${session.id} AND "revokedAt" IS NULL RETURNING *`;
        } else {
          // Final SQL clock predicate: crossing expiry before UPDATE cannot renew.
          rows = await tx.$queryRaw`UPDATE public."AuthSession" SET "lastActivityAt" = ${data.lastActivityAt},
            "idleExpiresAt" = ${data.idleExpiresAt}, "lastInteractionId" = ${data.lastInteractionId}, "revision" = "revision" + 1
            WHERE "id" = ${session.id} AND "revokedAt" IS NULL
            AND "idleExpiresAt" > clock_timestamp() AND "absoluteExpiresAt" > clock_timestamp() RETURNING *`;
        }
        if (rows.length !== 1) throw new SessionError('SESSION_EXPIRED');
        Object.assign(session, rows[0]);
      },
    };
  }
  return {
    forUser: (id, work) => transaction(async tx => work(context(tx, await lockUser(tx, id)))),
    forCredential: (credentialHash, work, isolationLevel) => transaction(async tx => {
      const found = await tx.authSession.findUnique({where:{credentialHash},select:{id:true,userId:true}});
      if (!found) return work(context(tx, null));
      const user = await lockUser(tx, found.userId);
      await tx.$queryRaw`SELECT "id" FROM public."AuthSession" WHERE "id" = ${found.id} FOR UPDATE`;
      const session = await tx.authSession.findUnique({where:{credentialHash}});
      return work(context(tx, user, session));
    }, isolationLevel),
  };
}
