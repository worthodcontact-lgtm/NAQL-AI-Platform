import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";

export async function registerPortRoutes(app: FastifyInstance) {
  app.get("/api/v1/ports", async () => {
    if (prisma) {
      const items = await (prisma as any).port.findMany({ take: 200 });
      return { items };
    }
    return { items: [], devFallback: true, message: "No database configured; run seed after setting DATABASE_URL." };
  });
}
