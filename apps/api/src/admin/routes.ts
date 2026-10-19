import { FastifyInstance } from "fastify";
import { registerAdminUserRoutes } from "./users.js";
import { registerAdminCompanyRoutes } from "./companies.js";
import { registerAdminOperationRoutes } from "./operations.js";
import { registerAdminSystemRoutes } from "./system.js";

/**
 * Platform administration API (`/api/v1/admin/*`).
 *
 * Authentication for this namespace is `app.authenticate` plus the admin-scope
 * and permission guards declared on each route. No route here trusts a role
 * supplied by the client.
 */
export async function registerAdminRoutes(app: FastifyInstance) {
  await registerAdminUserRoutes(app);
  await registerAdminCompanyRoutes(app);
  await registerAdminOperationRoutes(app);
  await registerAdminSystemRoutes(app);
}
