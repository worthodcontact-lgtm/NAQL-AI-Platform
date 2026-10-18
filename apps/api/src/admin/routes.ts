import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { getAuthUser } from "../auth/routes.js";
import { isPlatformStaff } from "../auth/roles.js";
import { listAudit } from "../audit/log.js";
import { devCompanies } from "../companies/routes.js";
import { devRfqs, devQuotesList, devBookings } from "../rfq/routes.js";

function forbidden(reply: any) { return reply.code(403).send({ error: "Forbidden" }); }

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/api/v1/admin/overview", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!isPlatformStaff(user)) return forbidden(reply);
    if (prisma) {
      const [companies, verified, pending, rfqs, quotes, bookings] = await Promise.all([
        (prisma as any).company.count(),
        (prisma as any).company.count({ where: { verificationStatus: "verified" } }),
        (prisma as any).company.count({ where: { verificationStatus: "pending" } }),
        (prisma as any).rfq.count(),
        (prisma as any).quote.count(),
        (prisma as any).bookingRequest.count()
      ]);
      return { companies, verifiedCompanies: verified, pendingVerifications: pending, rfqs, quotes, bookings };
    }
    return {
      companies: devCompanies.length,
      verifiedCompanies: devCompanies.filter((c) => c.verificationStatus === "verified").length,
      pendingVerifications: devCompanies.filter((c) => c.verificationStatus === "pending").length,
      rfqs: devRfqs.length,
      quotes: devQuotesList.length,
      bookings: devBookings.length,
      devFallback: true
    };
  });

  app.get("/api/v1/admin/companies", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!isPlatformStaff(user)) return forbidden(reply);
    const { status, verificationStatus } = request.query as { status?: string; verificationStatus?: string };
    if (prisma) {
      const items = await (prisma as any).company.findMany({
        where: { ...(status ? { status } : {}), ...(verificationStatus ? { verificationStatus } : {}) },
        include: { services: true, documents: true, reviews: true },
        orderBy: { createdAt: "desc" },
        take: 200
      });
      return { items };
    }
    const items = devCompanies.filter((c) => (!status || c.status === status) && (!verificationStatus || c.verificationStatus === verificationStatus));
    return { items, devFallback: true };
  });

  app.get("/api/v1/admin/audit", { onRequest: [app.authenticate] }, async (request, reply) => {
    const user = getAuthUser(request);
    if (!isPlatformStaff(user)) return forbidden(reply);
    const items = await listAudit(200);
    return { items, devFallback: !prisma };
  });
}
