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
  const password = "Phase4-browser-password!";
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
  name: string
): Promise<string> {
  const response = await request.post(`${api}/companies/register`, {
    headers: { authorization: `Bearer ${account.token}` },
    data: { name, type: "forwarder", country: "EG" }
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id;
}

async function seaports(request: APIRequestContext) {
  const response = await request.get(`${api}/ports`);
  expect(response.status()).toBe(200);
  const items = (await response.json()).items.filter((port: any) => port.type === "seaport");
  expect(items.length).toBeGreaterThanOrEqual(2);
  return [items[0], items[1]] as Array<{ id: string; name: string; code: string }>;
}

async function createShipment(
  request: APIRequestContext,
  account: Account,
  ports: Array<{ id: string; name: string; code: string }>,
  cargoDescription: string
): Promise<string> {
  const response = await request.post(`${api}/shipments`, {
    headers: { authorization: `Bearer ${account.token}` },
    data: {
      originPortId: ports[0].id,
      destinationPortId: ports[1].id,
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription,
      weightKg: 1250
    }
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id;
}

async function createRfq(
  request: APIRequestContext,
  account: Account,
  ports: Array<{ id: string; name: string; code: string }>,
  cargoDescription: string
): Promise<string> {
  const response = await request.post(`${api}/rfqs`, {
    headers: { authorization: `Bearer ${account.token}` },
    data: {
      origin: ports[0].name,
      destination: ports[1].name,
      originPortId: ports[0].id,
      destinationPortId: ports[1].id,
      mode: "SEA",
      incoterm: "FOB",
      cargoDescription,
      weightKg: 1250
    }
  });
  expect(response.status()).toBe(200);
  return (await response.json()).id;
}

async function login(page: Page, account: Account) {
  await page.goto("/login");
  await page.getByLabel("البريد الإلكتروني").fill(account.email);
  await page.getByLabel("كلمة المرور").fill(account.password);
  await page.getByRole("button", { name: "دخول" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("customer and provider complete quote, withdrawal, resubmission, booking and shipment linkage", async ({
  browser,
  request
}) => {
  test.setTimeout(120_000);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const customer = await register(request, "phase4-customer");
  const provider = await register(request, "phase4-provider");
  const providerCompanyName = `Phase 4 Provider ${suffix}`;
  const providerCompanyId = await createCompany(request, provider, providerCompanyName);
  const ports = await seaports(request);
  const cargo = `Phase 4 lifecycle cargo ${suffix}`;

  const customerContext = await browser.newContext();
  const providerContext = await browser.newContext();
  const customerPage = await customerContext.newPage();
  const providerPage = await providerContext.newPage();

  try {
    await login(customerPage, customer);
    await customerPage.goto("/rfqs");
    await customerPage.getByLabel("من").selectOption(ports[0].id);
    await customerPage.getByLabel("إلى").selectOption(ports[1].id);
    await customerPage.getByLabel("وصف البضاعة").fill(cargo);
    await customerPage.getByLabel("الوزن (kg)").fill("1250");
    await customerPage.getByLabel("شركة (اختياري)").selectOption(providerCompanyId);

    const [createResponse] = await Promise.all([
      customerPage.waitForResponse(
        (response) =>
          response.url() === `${api}/rfqs` &&
          response.request().method() === "POST"
      ),
      customerPage.getByRole("button", { name: "إنشاء RFQ" }).click()
    ]);
    expect(createResponse.status()).toBe(200);
    const rfqId = (await createResponse.json()).id as string;

    await customerPage.goto(`/rfqs/${rfqId}`);
    await expect(customerPage.getByText(cargo)).toBeVisible();

    await login(providerPage, provider);
    await providerPage.goto("/provider/rfqs");
    await expect(providerPage.getByText(cargo)).toBeVisible();
    await providerPage.getByRole("link", { name: "فتح الطلب" }).first().click();
    await expect(providerPage).toHaveURL(new RegExp(`/provider/rfqs/${rfqId}`));

    await providerPage.getByLabel("بصفة شركة").selectOption(providerCompanyId);
    await providerPage.getByLabel("وصف البند").first().fill("Ocean freight");
    await providerPage.getByLabel("القيمة").first().fill("1500");
    await providerPage.getByRole("button", { name: "إرسال العرض" }).click();
    await expect(providerPage.getByText("تم إرسال العرض. سيظهر للعميل للمقارنة.")).toBeVisible();

    // A provider may view the RFQ through the shared detail URL, but cannot
    // accept its own offer. The server also rejects such an attempt.
    await providerPage.goto(`/rfqs/${rfqId}`);
    await expect(providerPage.getByRole("button", { name: "اختيار هذا العرض" })).toHaveCount(0);

    await providerPage.goto(`/provider/rfqs/${rfqId}`);
    providerPage.once("dialog", (dialog) => dialog.accept());
    await providerPage.getByRole("button", { name: "سحب العرض" }).click();
    await expect(providerPage.getByText("تم سحب العرض وتسجيل ذلك في السجل.")).toBeVisible();
    await expect(providerPage.getByText("مسحوب")).toBeVisible();

    // The withdrawn revision is preserved, and a new submitted revision is
    // allowed because the active-quote partial index is clear.
    await providerPage.getByLabel("القيمة").first().fill("1500");
    await providerPage.getByRole("button", { name: "إرسال العرض" }).click();
    await expect(providerPage.getByText("تم إرسال العرض. سيظهر للعميل للمقارنة.")).toBeVisible();

    await customerPage.goto(`/rfqs/${rfqId}`);
    await expect(customerPage.getByText(providerCompanyName).first()).toBeVisible();
    customerPage.once("dialog", (dialog) => dialog.accept());
    await customerPage.getByRole("button", { name: "اختيار هذا العرض" }).click();
    await expect(customerPage.getByText("قرار العرض")).toBeVisible();
    await expect(customerPage.getByText("طلب الحجز:")).toBeVisible();

    const rfqAfterAccept = await request.get(`${api}/rfqs/${rfqId}`, {
      headers: { authorization: `Bearer ${customer.token}` }
    });
    expect(rfqAfterAccept.status()).toBe(200);
    const accepted = await rfqAfterAccept.json();
    expect(accepted.viewerRole).toBe("owner");
    expect(accepted.bookings).toHaveLength(1);
    const shipmentId = accepted.bookings[0].shipmentId as string;
    expect(shipmentId).toBeTruthy();
    expect(
      accepted.quotes.some(
        (quote: any) => quote.status === "accepted" && quote.company?.name === providerCompanyName
      )
    ).toBe(true);

    await providerPage.goto("/bookings");
    await expect(providerPage.getByText("بصفة مزوّد")).toBeVisible();
    await providerPage.getByLabel("رقم مرجع التأكيد (مطلوب)").fill(`BKG-${suffix}`);
    await providerPage.getByRole("button", { name: "تأكيد الحجز" }).click();
    await expect(providerPage.getByText("مؤكد", { exact: true })).toBeVisible();
    await expect(providerPage.getByRole("link", { name: /فتح الشحنة المرتبطة/ })).toBeVisible();

    const shipments = await request.get(`${api}/shipments/${shipmentId}`, {
      headers: { authorization: `Bearer ${customer.token}` }
    });
    expect(shipments.status()).toBe(200);
    expect((await shipments.json()).status).toBe("BOOKED");

    await customerPage.goto(`/shipments/${shipmentId}`);
    await expect(customerPage.getByText(cargo)).toBeVisible();
    await expect(customerPage.getByText("محجوز", { exact: true }).first()).toBeVisible();

    await customerPage.goto("/notifications");
    await expect(customerPage.getByText("عرض سعر مستلم").first()).toBeVisible();
    await expect(customerPage.getByText(/لا يوجد مزود بريد أو واتساب مهيأ/)).toBeVisible();
  } finally {
    await customerContext.close();
    await providerContext.close();
  }
});

test("cross-organization shipment and RFQ access is denied in the browser", async ({
  browser,
  request
}) => {
  test.setTimeout(90_000);
  const owner = await register(request, "phase4-owner");
  const outsider = await register(request, "phase4-outsider");
  const unrelatedProvider = await register(request, "phase4-unrelated-provider");
  await createCompany(request, unrelatedProvider, `Unrelated provider ${Date.now()}`);
  const ports = await seaports(request);
  const privateCargo = `Private customer cargo ${Date.now()}`;
  const shipmentId = await createShipment(request, owner, ports, privateCargo);
  const rfqCargo = `Private RFQ cargo ${Date.now()}`;
  const rfqId = await createRfq(request, owner, ports, rfqCargo);

  const ownerContext = await browser.newContext();
  const providerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const providerPage = await providerContext.newPage();

  try {
    await login(ownerPage, owner);
    await ownerPage.goto(`/shipments/${shipmentId}`);
    await expect(ownerPage.getByText(privateCargo)).toBeVisible();

    // A different organization cannot read the shipment by knowing its URL.
    await login(ownerPage, outsider);
    await ownerPage.goto(`/shipments/${shipmentId}`);
    await expect(ownerPage.getByText(/not found|forbidden/i)).toBeVisible();
    await expect(ownerPage.getByText(privateCargo)).toHaveCount(0);

    // An uninvited provider cannot discover the RFQ by guessing its id.
    await login(providerPage, unrelatedProvider);
    await providerPage.goto(`/rfqs/${rfqId}`);
    await expect(providerPage.getByText(/forbidden|not found/i)).toBeVisible();
    await expect(providerPage.getByText(rfqCargo)).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await providerContext.close();
  }
});
