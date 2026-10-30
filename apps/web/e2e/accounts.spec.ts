import { expect, test } from "@playwright/test";

const suffix = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

test("customer registration captures importer/exporter intent and keeps provider navigation closed", async ({
  page
}) => {
  const id = suffix();
  await page.goto("/register");

  await page.getByRole("radio", { name: /عميل/ }).check();
  await page.getByLabel("الاسم", { exact: true }).fill("Phase 5 Customer");
  await page.getByLabel("البريد الإلكتروني").fill(`phase5-customer-ui-${id}@example.test`);
  await page.getByLabel("كلمة المرور (8 أحرف على الأقل)").fill("Phase5-customer-password!");
  await page.getByLabel("اسم الشركة / المنشأة (اختياري)").fill(`Customer Trading ${id}`);
  await page.getByLabel("نشاط التجارة الخارجية").selectOption("both");
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByText("حساب عميل (مستورد / مصدّر)").first()).toBeVisible();
  await expect(page.getByText(/مستورد ومصدّر/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "صندوق وفرص الطلبات" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "طلبات العروض" }).first()).toBeVisible();
});

test("provider registration enters the provider profile onboarding without verification", async ({
  page
}) => {
  const id = suffix();
  await page.goto("/register");

  await page.getByRole("radio", { name: /مزوّد خدمة لوجستية/ }).check();
  await page.getByLabel("الاسم", { exact: true }).fill("Phase 5 Provider");
  await page.getByLabel("البريد الإلكتروني").fill(`phase5-provider-ui-${id}@example.test`);
  await page.getByLabel("كلمة المرور (8 أحرف على الأقل)").fill("Phase5-provider-password!");
  await page.getByLabel("اسم المنظمة (مطلوب)").fill(`Provider Onboarding ${id}`);
  await page.getByRole("button", { name: "إنشاء الحساب" }).click();

  await expect(page).toHaveURL(/\/company\/register\?onboarding=provider/);
  await expect(page.getByRole("heading", { name: "ملف مزوّد الخدمة" })).toBeVisible();
  await expect(page.getByText(/تم إنشاء حساب مزوّد الخدمة/)).toBeVisible();
  await expect(page.getByText("حساب مزوّد خدمة لوجستية").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "صندوق وفرص الطلبات" })).toHaveCount(0);

  await page.getByLabel("الاسم القانوني").fill(`Provider Legal ${id}`);
  await page.getByRole("button", { name: "تسجيل الشركة" }).click();
  await expect(page.getByText(/تم إنشاء ملف الشركة وتحويل مساحة العمل إلى حساب مزوّد خدمة/)).toBeVisible();
  await expect(page.getByRole("link", { name: "صندوق وفرص الطلبات" }).first()).toBeVisible();
  await expect(page.getByText(/غير موثقة|غير موثّق|unregistered/i).first()).toBeVisible();
});
