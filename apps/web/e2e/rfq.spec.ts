import { expect, test } from "@playwright/test";

const api = "http://127.0.0.1:4001/api/v1";

test("a registered customer signs in and creates an RFQ through the web app", async ({ page, request }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `phase41-${suffix}@example.test`;
  const password = "Phase41-test-password!";
  const registration = await request.post(`${api}/auth/register`, {
    data: { email, password, displayName: "Phase 4.1 Customer", organizationName: `Phase 4.1 ${suffix}` }
  });
  expect(registration.status()).toBe(200);

  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(email);
  await page.getByLabel("كلمة المرور").fill(password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto("/rfqs");
  await expect(page.getByRole("heading", { name: "طلبات العروض (RFQ)" })).toBeVisible();
  await page.getByLabel("من").selectOption({ label: "Alexandria Port (ALY)" });
  await page.getByLabel("إلى").selectOption({ label: "Port Said (PSD)" });
  await page.getByLabel("وصف البضاعة").fill(`Phase 4.1 E2E cargo ${suffix}`);
  await page.getByLabel("الوزن (kg)").fill("1250");
  await page.getByRole("button", { name: "إنشاء RFQ" }).click();

  await expect(page.getByRole("heading", { name: "Alexandria Port → Port Said" })).toBeVisible();
  await expect(page.getByRole("link", { name: "التفاصيل" }).first()).toBeVisible();
  await page.getByRole("link", { name: "التفاصيل" }).first().click();
  await expect(page.getByText(new RegExp(`Phase 4\\.1 E2E cargo ${suffix}`))).toBeVisible();
});
