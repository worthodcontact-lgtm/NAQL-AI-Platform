import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

/**
 * Phase 1 membership safety tests.
 *
 * The local development database contains legacy multi-role membership rows, so
 * the schema intentionally remains multi-role. These tests prove that member
 * management replaces/revokes the complete role set instead of editing one row
 * and leaving stale privileges behind.
 */
// Use the actual client rather than the environment variable: a stale or empty
// DATABASE_URL must not make a database-only suite run against the dev fallback.
const hasDatabase = Boolean(prisma);
const suite = hasDatabase ? describe : describe.skip;
const stamp = Date.now();

let app: any;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

async function json(res: any) {
  try {
    return JSON.parse(res.payload);
  } catch {
    return null;
  }
}

async function register(prefix: string) {
  const email = `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}@naql.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: { email, password: "password123", displayName: prefix }
  });
  expect(res.statusCode).toBe(200);
  return { email, token: (await json(res)).token as string, user: (await json(res)).user };
}

async function login(email: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: "password123" }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).token as string;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

suite("multi-role membership revocation", () => {
  it("replaces every old role on change and deletes every role on removal", async () => {
    const owner = await register("multi-owner");
    const member = await register("multi-member");
    const ownerOrganizationId = owner.user.organizationId as string;

    const invite = await app.inject({
      method: "POST",
      url: "/api/v1/company/members/invite",
      headers: auth(owner.token),
      payload: { email: member.email, role: "VIEWER" }
    });
    expect(invite.statusCode).toBe(200);
    const invitation = (await json(invite)).invitation;

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/auth/company-invitations/memberships/${invitation.id}/accept`,
      headers: auth(member.token)
    });
    expect(accept.statusCode).toBe(200);
    expect((await json(accept)).switchRequired).toBe(true);

    const switched = await app.inject({
      method: "POST",
      url: "/api/v1/auth/switch-organization",
      headers: auth(member.token),
      payload: { organizationId: ownerOrganizationId }
    });
    expect(switched.statusCode).toBe(200);
    let memberToken = (await json(switched)).token as string;

    // Simulate legacy data: the same user holds two active roles in one org.
    await prisma!.membership.create({
      data: {
        organizationId: ownerOrganizationId,
        userId: member.user.id,
        role: "FINANCE_USER",
        status: "active"
      }
    });

    const before = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: auth(memberToken) });
    expect(before.statusCode).toBe(200);
    expect(new Set((await json(before)).user.roles)).toEqual(new Set(["VIEWER", "FINANCE_USER"]));

    const members = await app.inject({
      method: "GET",
      url: "/api/v1/company/members",
      headers: auth(owner.token)
    });
    expect(members.statusCode).toBe(200);
    const memberView = (await json(members)).items.find(
      (item: any) => item.user.email === member.email
    );
    expect(memberView).toBeTruthy();
    expect(new Set(memberView.roles)).toEqual(new Set(["VIEWER", "FINANCE_USER"]));

    const changed = await app.inject({
      method: "PATCH",
      url: `/api/v1/company/members/${memberView.id}`,
      headers: auth(owner.token),
      payload: { role: "LOGISTICS_OPERATOR" }
    });
    expect(changed.statusCode).toBe(200);
    expect((await json(changed)).roles).toEqual(["LOGISTICS_OPERATOR"]);

    const afterChange = await prisma!.membership.findMany({
      where: { organizationId: ownerOrganizationId, userId: member.user.id }
    });
    expect(afterChange).toHaveLength(1);
    expect(afterChange[0].role).toBe("LOGISTICS_OPERATOR");

    const oldTokenAfterChange = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(memberToken)
    });
    expect(oldTokenAfterChange.statusCode).toBe(401);
    expect((await json(oldTokenAfterChange)).code).toBe("session_revoked");

    memberToken = await login(member.email);
    await prisma!.membership.create({
      data: {
        organizationId: ownerOrganizationId,
        userId: member.user.id,
        role: "VIEWER",
        status: "active"
      }
    });

    const membersAgain = await app.inject({
      method: "GET",
      url: "/api/v1/company/members",
      headers: auth(owner.token)
    });
    const memberViewAgain = (await json(membersAgain)).items.find(
      (item: any) => item.user.email === member.email
    );
    expect(memberViewAgain).toBeTruthy();
    expect(new Set(memberViewAgain.roles)).toEqual(new Set(["LOGISTICS_OPERATOR", "VIEWER"]));

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/v1/company/members/${memberViewAgain.id}`,
      headers: auth(owner.token)
    });
    expect(removed.statusCode).toBe(200);
    expect((await json(removed)).removedRoles).toBe(2);

    const afterRemoval = await prisma!.membership.findMany({
      where: { organizationId: ownerOrganizationId, userId: member.user.id }
    });
    expect(afterRemoval).toHaveLength(0);

    const oldTokenAfterRemoval = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(memberToken)
    });
    expect(oldTokenAfterRemoval.statusCode).toBe(401);
    expect((await json(oldTokenAfterRemoval)).code).toBe("session_revoked");

    // The account falls back to its other active workspace, not to the removed
    // one. A fresh login must not resurrect the deleted membership.
    const fallbackToken = await login(member.email);
    const fallback = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: auth(fallbackToken)
    });
    expect(fallback.statusCode).toBe(200);
    expect((await json(fallback)).user.organizationId).not.toBe(ownerOrganizationId);
  });
});
