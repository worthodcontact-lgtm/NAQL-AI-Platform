import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "http://127.0.0.1:4001/api/v1";

type Account = {
  email: string;
  password: string;
  token: string;
  displayName: string;
};

async function register(request: APIRequestContext, prefix: string): Promise<Account> {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `${prefix}-${suffix}@example.test`;
  const password = "Phase5-browser-password!";
  const displayName = `${prefix} browser`;
  const response = await request.post(`${api}/auth/register`, {
    data: {
      email,
      password,
      displayName,
      organizationName: `${prefix} organization ${suffix}`
    }
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { email, password, token: body.token, displayName };
}

async function createCompany(
  request: APIRequestContext,
  account: Account,
  name: string,
  mode = "SEA"
): Promise<{ id: string; name: string }> {
  const response = await request.post(`${api}/companies/register`, {
    headers: { authorization: `Bearer ${account.token}` },
    data: {
      name,
      nameEn: name,
      type: "forwarder",
      country: "EG",
      services: [
        {
          mode,
          serviceType: "ocean_freight",
          originLocation: "Alexandria",
          destinationLocation: "Jeddah",
          shipmentTypes: ["FCL"]
        }
      ]
    }
  });
  expect(response.status()).toBe(200);
  return { id: (await response.json()).id, name };
}

async function seaports(request: APIRequestContext) {
  const response = await request.get(`${api}/ports`);
  expect(response.status()).toBe(200);
  const items = (await response.json()).items.filter((port: any) => port.type === "seaport");
  expect(items.length).toBeGreaterThanOrEqual(2);
  return [items[0], items[1]] as Array<{ id: string; name: string; code: string }>;
}

async function login(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(account.email);
  await page.getByLabel("كلمة المرور").fill(account.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("public directory shows registered and unverified records honestly", async ({ page }) => {
  await page.goto("/directory");
  await page.getByLabel("بحث بالاسم أو الخدمة").fill("Maersk");
  await page.getByRole("button", { name: "بحث" }).click();

  const maerskCard = page.getByRole("link", { name: /Maersk/ }).first();
  await expect(maerskCard).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maersk" })).toBeVisible();
  await expect(maerskCard.getByText("سجل عام", { exact: true })).toBeVisible();
  await expect(maerskCard.getByText("غير موثقة").first()).toBeVisible();
  await expect(maerskCard.getByText(/الأسعار: غير مربوط/).first()).toBeVisible();
  await expect(maerskCard.getByText(/لم يُتحقق منه مستقلاً/).first()).toBeVisible();
});

test("provider discovers a marketplace RFQ, joins, quotes with provenance and customer accepts", async ({
  browser,
  request
}) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const customer = await register(request, "phase5-customer");
  const provider = await register(request, "phase5-provider");
  const company = await createCompany(request, provider, `Phase 5 Provider ${suffix}`);
  const ports = await seaports(request);
  const cargo = `Phase 5 marketplace cargo ${suffix}`;

  const create = await request.post(`${api}/rfqs`, {
    headers: { authorization: `Bearer ${customer.token}` },
    data: {
      origin: ports[0].name,
      destination: ports[1].name,
      originPortId: ports[0].id,
      destinationPortId: ports[1].id,
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription: cargo,
      weightKg: 1250,
      volumeCbm: 12.5,
      requiredService: "Ocean freight and customs clearance",
      discoveryMode: "marketplace",
      recipientCompanyIds: []
    }
  });
  expect(create.status()).toBe(200);
  const rfqId = (await create.json()).id as string;

  const providerContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const providerPage = await providerContext.newPage();
  const customerPage = await customerContext.newPage();

  try {
    await login(providerPage, provider);
    await providerPage.goto("/provider/rfqs");
    await expect(providerPage.getByRole("heading", { name: "فرص السوق المفتوح" })).toBeVisible();
    const opportunityCard = providerPage.getByTestId(`opportunity-${rfqId}`);
    await expect(opportunityCard.getByText(cargo)).toBeVisible();
    await opportunityCard
      .getByRole("button", { name: new RegExp(`الانضمام بصفة ${company.name}`) })
      .click();
    await expect(providerPage.getByText(/تم الانضمام إلى فرصة السوق/)).toBeVisible();

    await opportunityCard.getByRole("link", { name: "فتح الطلب" }).click();
    await expect(providerPage).toHaveURL(new RegExp(`/provider/rfqs/${rfqId}`));
    await expect(providerPage.getByText("بيانات الطلب المشتركة")).toBeVisible();
    await providerPage.getByLabel("بصفة شركة").selectOption(company.id);
    await providerPage.getByLabel("مصدر التسعير").selectOption("estimated");
    await providerPage.getByLabel("درجة الثقة").selectOption("estimated");
    await providerPage.getByLabel("رسوم غير معروفة (مفصولة بفواصل)").fill("Destination weighing fee");
    await providerPage.getByLabel("خدمات مستبعدة (مفصولة بفواصل)").fill("Customs clearance");
    await providerPage.getByLabel("وصف البند").first().fill("Ocean freight");
    await providerPage.getByLabel("القيمة").first().fill("1500");
    await providerPage.getByRole("button", { name: "إرسال العرض" }).click();
    await expect(providerPage.getByText("تم إرسال العرض. سيظهر للعميل للمقارنة.")).toBeVisible();

    await login(customerPage, customer);
    await customerPage.goto(`/rfqs/${rfqId}`);
    await expect(customerPage.getByText(company.name).first()).toBeVisible();
    await expect(customerPage.getByText(/سعر تقديري/).first()).toBeVisible();
    await expect(customerPage.getByText(/رسوم غير معروفة/).first()).toBeVisible();
    await expect(customerPage.getByText(/خدمات مستبعدة/).first()).toBeVisible();

    customerPage.once("dialog", (dialog) => dialog.accept());
    await customerPage.getByRole("button", { name: "اختيار هذا العرض" }).click();
    await expect(customerPage.getByText("قرار العرض")).toBeVisible();
    await expect(customerPage.getByText("طلب الحجز:")).toBeVisible();
    await expect(customerPage.getByText(/لا يُنشئ حجزاً لدى خط ملاحي أو ناقل خارجي/)).toBeVisible();
  } finally {
    await providerContext.close();
    await customerContext.close();
  }
});
