import { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { persistenceMode } from "../config/env.js";

export async function registerPortRoutes(app: FastifyInstance) {
  /**
   * Reference data for origin/destination selection.
   *
   * Without a database this returns an explicit, empty, labelled result rather than
   * fabricated ports. Run `pnpm --filter @naql/api prisma:seed` after configuring
   * DATABASE_URL to populate the directory.
   */
  app.get("/api/v1/ports", async (request) => {
    const { country, type, q } = request.query as { country?: string; type?: string; q?: string };

    if (prisma) {
      const items = await (prisma as any).port.findMany({
        where: {
          ...(country ? { country } : {}),
          ...(type ? { type } : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { code: { contains: q, mode: "insensitive" } }
                ]
              }
            : {})
        },
        orderBy: [{ country: "asc" }, { name: "asc" }],
        take: 300
      });
      return {
        items,
        persistenceMode,
        disclaimer:
          "Coordinates are approximate published positions, not official survey records."
      };
    }

    return {
      items: [],
      persistenceMode,
      unavailable: true,
      message:
        "No database is configured, so the port directory is empty. Set DATABASE_URL and run the seed script; no ports are invented."
    };
  });
}
