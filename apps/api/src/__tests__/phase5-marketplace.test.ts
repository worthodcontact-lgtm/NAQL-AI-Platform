import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";

const suite = prisma ? describe : describe.skip;
let app: any;
const stamp = Date.now();

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

async function register(prefix: string): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/register",
    payload: {
      email: `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 8)}@naql.test`,
      password: "Phase5-test-password!",
      displayName: prefix,
      organizationName: `${prefix} organization ${Math.random().toString(36).slice(2, 8)}`
    }
  });
  expect(res.statusCode).toBe(200);
  return (await json(res)).token;
}

async function createCompany(
  token: string,
  input: {
    name: string;
    type: string;
    mode?: string;
    serviceType?: string;
    origin?: string;
    destination?: string;
    publicContactConsent?: boolean;
    email?: string;
  }
): Promise<{ id: string; name: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/companies/register",
    headers: auth(token),
    payload: {
      name: input.name,
      nameEn: input.name,
      type: input.type,
      country: "EG",
      email: input.email,
      publicContactConsent: input.publicContactConsent,
      services: [
        {
          mode: input.mode ?? "SEA",
          serviceType: input.serviceType ?? "ocean_freight",
          originLocation: input.origin ?? "Alexandria",
          destinationLocation: input.destination ?? "Jeddah",
          shipmentTypes: ["FCL", "LCL"]
        }
      ]
    }
  });
  expect(res.statusCode).toBe(200);
  const body = await json(res);
  return { id: body.id, name: body.name };
}

async function ports(): Promise<Array<{ id: string; type: string }>> {
  const res = await app.inject({ method: "GET", url: "/api/v1/ports" });
  expect(res.statusCode).toBe(200);
  return (await json(res)).items ?? [];
}

async function createRfq(
  token: string,
  input: {
    recipientCompanyIds?: string[];
    discoveryMode?: "invited" | "marketplace";
    status?: "draft" | "submitted";
    mode?: string;
    originPortId?: string;
    destinationPortId?: string;
    cargoDescription?: string;
  }
): Promise<any> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/rfqs",
    headers: auth(token),
    payload: {
      origin: "Alexandria",
      destination: "Jeddah",
      originPortId: input.originPortId,
      destinationPortId: input.destinationPortId,
      incoterm: input.originPortId ? "FOB" : undefined,
      mode: input.mode ?? "SEA",
      cargoDescription: input.cargoDescription ?? `Phase 5 cargo ${Math.random()}`,
      weightKg: 1250,
      volumeCbm: 12.5,
      packageCount: 20,
      containerCount: 1,
      containerType: "20GP",
      requiredService: "Ocean freight and customs clearance",
      preferredPickupDate: new Date(Date.now() + 86_400_000).toISOString(),
      preferredDeliveryDate: new Date(Date.now() + 12 * 86_400_000).toISOString(),
      latestDeliveryDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      cargoValue: 25000,
      cargoCurrency: "USD",
      isHazardous: false,
      specialRequirements: "Fragile packing",
      discoveryMode: input.discoveryMode ?? "invited",
      status: input.status ?? "submitted",
      recipientCompanyIds: input.recipientCompanyIds ?? []
    }
  });
  return { statusCode: res.statusCode, body: await json(res) };
}

async function submitQuote(
  token: string,
  rfqId: string,
  companyId: string,
  overrides: Record<string, any> = {}
): Promise<any> {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/rfqs/${rfqId}/quotes`,
    headers: auth(token),
    payload: {
      companyId,
      currency: "USD",
      transitDays: 14,
      validityUntil: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      pricingSource: "provider_submitted",
      priceConfidence: "indicative",
      items: [
        { label: "Ocean freight", amount: 1000, currency: "USD", included: true, chargeType: "freight" },
        { label: "Port fees", amount: 250, currency: "USD", included: true, chargeType: "fee" }
      ],
      ...overrides
    }
  });
  return { statusCode: res.statusCode, body: await json(res) };
}

suite("Phase 5 marketplace", () => {
  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps public carrier candidates unverified and distinguishes registration", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/companies/directory?q=Maersk&registered=false" });
    expect(res.statusCode).toBe(200);
    const body = await json(res);
    const maersk = body.items.find((item: any) => item.name.includes("Maersk"));
    expect(maersk).toBeTruthy();
    expect(maersk.isRegistered).toBe(false);
    expect(maersk.verificationStatus).toBe("unverified");
    expect(maersk.contactPublished).toBe(false);
    expect(maersk.email).toBeNull();
    expect(maersk.pricingIntegrationStatus).toBe("NOT_CONFIGURED");
    expect(maersk.availabilityIntegrationStatus).toBe("NOT_CONFIGURED");
    expect(maersk.dataSource).toBeTruthy();
    expect(maersk.organizationId).toBeUndefined();
  });

  it("filters by category, mode, service, coverage and registration, with pagination", async () => {
    const token = await register("directory-provider");
    const unique = `Unique Logistics ${Math.random().toString(36).slice(2, 8)}`;
    const company = await createCompany(token, {
      name: unique,
      type: "forwarder",
      mode: "SEA",
      serviceType: `ocean_${Math.random().toString(36).slice(2, 8)}`,
      origin: "Alexandria",
      destination: "Jeddah",
      publicContactConsent: true,
      email: `contact-${Math.random().toString(36).slice(2, 8)}@example.test`
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/companies/directory?q=${encodeURIComponent(unique)}&type=forwarder&mode=SEA&registered=true&coverage=Alexandria`
    });
    expect(res.statusCode).toBe(200);
    const body = await json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(company.id);
    expect(body.items[0].isRegistered).toBe(true);
    expect(body.items[0].contactPublished).toBe(true);
    expect(body.items[0].email).toContain("contact-");
    expect(body.items[0].organizationId).toBeUndefined();

    const profile = await app.inject({ method: "GET", url: `/api/v1/companies/${company.id}` });
    expect(profile.statusCode).toBe(200);
    const profileBody = await json(profile);
    expect(profileBody.isRegistered).toBe(true);
    expect(profileBody.organizationId).toBeUndefined();
    expect(profileBody.services[0].shipmentTypes).toEqual(["FCL", "LCL"]);

    const unregistered = await app.inject({
      method: "GET",
      url: `/api/v1/companies/directory?q=${encodeURIComponent(unique)}&registered=false`
    });
    expect((await json(unregistered)).total).toBe(0);

    const page = await app.inject({ method: "GET", url: "/api/v1/companies/directory?type=shipping&limit=2" });
    const pageBody = await json(page);
    expect(pageBody.total).toBeGreaterThanOrEqual(11);
    expect(pageBody.items).toHaveLength(2);
    expect(pageBody.hasMore).toBe(true);
  });

  it("supports drafts, explicit submission, cancellation and provider-safe visibility", async () => {
    const customer = await register("draft-customer");
    const provider = await register("draft-provider");
    const company = await createCompany(provider, {
      name: `Draft Provider ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder"
    });

    const draft = await createRfq(customer, {
      recipientCompanyIds: [company.id],
      status: "draft",
      cargoDescription: "Draft-only cargo"
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.body.status).toBe("draft");

    const hiddenInbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(provider)
    });
    expect((await json(hiddenInbox)).items.some((row: any) => row.rfq?.id === draft.body.id)).toBe(false);

    const detailAsProvider = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${draft.body.id}`,
      headers: auth(provider)
    });
    expect(detailAsProvider.statusCode).toBe(403);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${draft.body.id}/submit`,
      headers: auth(customer),
      payload: {}
    });
    expect(submitted.statusCode).toBe(200);
    expect((await json(submitted)).status).toBe("submitted");

    const inbox = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/incoming",
      headers: auth(provider)
    });
    const inboxBody = await json(inbox);
    const row = inboxBody.items.find((candidate: any) => candidate.rfq?.id === draft.body.id);
    expect(row).toBeTruthy();
    expect(row.rfq.organizationId).toBeUndefined();
    expect(row.rfq.createdByUserId).toBeUndefined();

    const quoted = await submitQuote(provider, draft.body.id, company.id);
    expect(quoted.statusCode).toBe(200);

    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${draft.body.id}/cancel`,
      headers: auth(customer),
      payload: { reason: "Customer changed the shipment plan" }
    });
    expect(cancelled.statusCode).toBe(200);
    expect((await json(cancelled)).status).toBe("cancelled");

    const afterCancel = await submitQuote(provider, draft.body.id, company.id);
    expect(afterCancel.statusCode).toBe(409);
    expect(afterCancel.body.code).toBe("rfq_not_open");

    const activity = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${draft.body.id}/activity`,
      headers: auth(customer)
    });
    const activityBody = await json(activity);
    expect(activityBody.items.some((event: any) => event.type === "RFQ_CANCELLED")).toBe(true);
    expect(activityBody.items.some((event: any) => event.type === "QUOTE_SUBMITTED")).toBe(true);
  });

  it("limits marketplace discovery, enforces eligibility and explicit joining", async () => {
    const customer = await register("market-customer");
    const seaProvider = await register("market-sea");
    const airProvider = await register("market-air");
    const outsider = await register("market-outsider");
    const seaCompany = await createCompany(seaProvider, {
      name: `Market Sea ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder",
      mode: "SEA"
    });
    await createCompany(airProvider, {
      name: `Market Air ${Math.random().toString(36).slice(2, 8)}`,
      type: "air",
      mode: "AIR"
    });

    const rfq = await createRfq(customer, { discoveryMode: "marketplace", cargoDescription: "Marketplace visible cargo" });
    expect(rfq.statusCode).toBe(200);
    expect(rfq.body.recipients).toHaveLength(0);

    const seaOpportunities = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/opportunities",
      headers: auth(seaProvider)
    });
    const seaBody = await json(seaOpportunities);
    const seaItem = seaBody.items.find((item: any) => item.id === rfq.body.id);
    expect(seaItem).toBeTruthy();
    expect(seaItem.organizationId).toBeUndefined();
    expect(seaItem.createdByUserId).toBeUndefined();
    expect(seaItem.eligibleCompanyIds).toContain(seaCompany.id);
    expect(seaItem.joined).toBe(false);

    const airOpportunities = await app.inject({
      method: "GET",
      url: "/api/v1/rfqs/opportunities",
      headers: auth(airProvider)
    });
    const airBody = await json(airOpportunities);
    expect(airBody.items.some((item: any) => item.id === rfq.body.id)).toBe(false);

    const join = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/join`,
      headers: auth(seaProvider),
      payload: { companyId: seaCompany.id }
    });
    expect(join.statusCode).toBe(200);
    expect((await json(join)).joined).toBe(true);

    const joinAgain = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/join`,
      headers: auth(seaProvider),
      payload: { companyId: seaCompany.id }
    });
    expect((await json(joinAgain)).alreadyJoined).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}`,
      headers: auth(seaProvider)
    });
    const detailBody = await json(detail);
    expect(detail.statusCode).toBe(200);
    expect(detailBody.viewerRole).toBe("provider");
    expect(detailBody.organizationId).toBeUndefined();
    expect(detailBody.createdByUserId).toBeUndefined();
    expect(detailBody.recipients).toHaveLength(1);

    const outsiderDetail = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}`,
      headers: auth(outsider)
    });
    expect(outsiderDetail.statusCode).toBe(403);
    const outsiderActivity = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/activity`,
      headers: auth(outsider)
    });
    expect(outsiderActivity.statusCode).toBe(403);
    const outsiderDocuments = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(outsider)
    });
    expect(outsiderDocuments.statusCode).toBe(403);
  });

  it("preserves pricing provenance, currencies and excluded/unknown charges", async () => {
    const customer = await register("quote-customer");
    const provider = await register("quote-provider");
    const outsider = await register("quote-outsider");
    const company = await createCompany(provider, {
      name: `Quote Provider ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder"
    });
    const rfq = await createRfq(customer, { recipientCompanyIds: [company.id] });
    expect(rfq.statusCode).toBe(200);

    const negative = await submitQuote(provider, rfq.body.id, company.id, {
      items: [{ label: "Invalid", amount: -1, currency: "USD", included: true }]
    });
    expect(negative.statusCode).toBe(400);

    const mixed = await submitQuote(provider, rfq.body.id, company.id, {
      items: [{ label: "Mixed", amount: 10, currency: "EUR", included: true }]
    });
    expect(mixed.statusCode).toBe(400);
    expect(mixed.body.code).toBe("currency_mismatch");

    const contradictory = await submitQuote(provider, rfq.body.id, company.id, {
      pricingSource: "estimated",
      priceConfidence: "confirmed"
    });
    expect(contradictory.statusCode).toBe(400);

    const unsourcedTariff = await submitQuote(provider, rfq.body.id, company.id, {
      pricingSource: "published_tariff"
    });
    expect(unsourcedTariff.statusCode).toBe(400);

    const excludedOnly = await submitQuote(provider, rfq.body.id, company.id, {
      items: [{ label: "Optional only", amount: 100, currency: "USD", included: false }]
    });
    expect(excludedOnly.statusCode).toBe(400);

    const quote = await submitQuote(provider, rfq.body.id, company.id, {
      pricingSource: "estimated",
      priceConfidence: "estimated",
      notes: "Ocean freight is indicative pending space confirmation.",
      unknownCharges: ["Destination weighing fee"],
      excludedServices: ["Customs clearance"],
      items: [
        { label: "Ocean freight", amount: 1000, currency: "USD", included: true, chargeType: "freight", pricingSource: "estimated", priceConfidence: "estimated" },
        { label: "Port fees", amount: 250, currency: "USD", included: true, chargeType: "fee" },
        { label: "Optional insurance", amount: 50, currency: "USD", included: false, optional: true, chargeType: "service" }
      ]
    });
    expect(quote.statusCode).toBe(200);
    expect(quote.body.totalAmount).toBe(1250);
    expect(quote.body.knownSubtotal).toBe(1250);
    expect(quote.body.excludedSubtotal).toBe(50);
    expect(quote.body.hasEstimatedComponents).toBe(true);
    expect(quote.body.hasUnknownCharges).toBe(true);
    expect(quote.body.revisionNumber).toBe(1);

    const firstQuoteId = quote.body.id;
    const withdrawn = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/quotes/${firstQuoteId}/withdraw`,
      headers: auth(provider),
      payload: {}
    });
    expect(withdrawn.statusCode).toBe(200);

    const revision = await submitQuote(provider, rfq.body.id, company.id, {
      items: [{ label: "Revised ocean freight", amount: 1200, currency: "USD", included: true, chargeType: "freight" }]
    });
    expect(revision.statusCode).toBe(200);
    expect(revision.body.revisionNumber).toBe(2);
    expect(revision.body.supersedesQuoteId).toBe(firstQuoteId);

    const compare = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/quotes/compare`,
      headers: auth(customer)
    });
    expect(compare.statusCode).toBe(200);
    const compareBody = await json(compare);
    expect(compareBody.crossCurrencyComparison).toBe(false);
    expect(compareBody.groups).toHaveLength(1);
    expect(compareBody.groups[0].currency).toBe("USD");
    expect(compareBody.groups[0].lowestIncludedTotal).toBe(1200);
    expect(compareBody.groups[0].quotes[0].serviceDifferences).toBeTruthy();

    const denied = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/quotes/compare`,
      headers: auth(outsider)
    });
    expect(denied.statusCode).toBe(403);
  });

  it("accepts one quote atomically, links a shipment and handles concurrent retries", async () => {
    const customer = await register("accept-customer");
    const provider = await register("accept-provider");
    const secondProvider = await register("accept-provider-2");
    const outsider = await register("accept-outsider");
    const company = await createCompany(provider, {
      name: `Accept Provider ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder"
    });
    const secondCompany = await createCompany(secondProvider, {
      name: `Accept Provider Two ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder"
    });
    const portList = (await ports()).filter((port) => port.type === "seaport");
    expect(portList.length).toBeGreaterThanOrEqual(2);
    const rfq = await createRfq(customer, {
      recipientCompanyIds: [company.id, secondCompany.id],
      originPortId: portList[0].id,
      destinationPortId: portList[1].id
    });
    expect(rfq.statusCode).toBe(200);

    const first = await submitQuote(provider, rfq.body.id, company.id);
    expect(first.statusCode).toBe(200);
    const second = await submitQuote(secondProvider, rfq.body.id, secondCompany.id, {
      items: [{ label: "Second offer", amount: 900, currency: "USD", included: true }]
    });
    expect(second.statusCode).toBe(200);

    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfq.body.id}/accept`,
        headers: auth(customer),
        payload: { quoteId: first.body.id }
      }),
      app.inject({
        method: "POST",
        url: `/api/v1/rfqs/${rfq.body.id}/accept`,
        headers: auth(customer),
        payload: { quoteId: first.body.id }
      })
    ]);
    expect(concurrent.map((response) => response.statusCode)).toEqual([200, 200]);
    const bookings = await Promise.all(concurrent.map(json));
    expect(bookings[0].id).toBe(bookings[1].id);
    expect(bookings.filter((booking) => booking.alreadyAccepted).length).toBe(1);

    const secondAccept = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/accept`,
      headers: auth(customer),
      payload: { quoteId: second.body.id }
    });
    expect(secondAccept.statusCode).toBe(409);
    expect((await json(secondAccept)).code).toBe("quotation_already_accepted");

    const crossOrgAccept = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/accept`,
      headers: auth(outsider),
      payload: { quoteId: first.body.id }
    });
    expect(crossOrgAccept.statusCode).toBe(404);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}`,
      headers: auth(customer)
    });
    const detailBody = await json(detail);
    expect(detailBody.status).toBe("accepted");
    expect(detailBody.bookings).toHaveLength(1);
    expect(detailBody.bookings[0].shipmentId).toBeTruthy();
    expect(detailBody.quotes.find((quote: any) => quote.id === first.body.id).status).toBe("accepted");
    expect(detailBody.quotes.find((quote: any) => quote.id === second.body.id).status).toBe("rejected");

    const providerBooking = await app.inject({
      method: "GET",
      url: "/api/v1/bookings",
      headers: auth(provider)
    });
    expect(providerBooking.statusCode).toBe(200);
    expect((await json(providerBooking)).items.some((booking: any) => booking.id === bookings[0].id)).toBe(true);

    const providerDetail = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}`,
      headers: auth(provider)
    });
    const providerBody = await json(providerDetail);
    expect(providerBody.quotes).toHaveLength(1);
    expect(providerBody.quotes[0].id).toBe(first.body.id);

    const customerNotifications = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: auth(customer)
    });
    expect(customerNotifications.statusCode).toBe(200);
    expect((await json(customerNotifications)).items.length).toBeGreaterThanOrEqual(2);

    const providerNotifications = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: auth(provider)
    });
    expect(
      (await json(providerNotifications)).items.some((notification: any) => notification.type === "QUOTATION_ACCEPTED")
    ).toBe(true);
    expect(
      (await json(providerNotifications)).items.some((notification: any) => notification.type === "QUOTATION_REJECTED")
    ).toBe(false);
  });

  it("authorizes RFQ documents and keeps private documents away from providers", async () => {
    const customer = await register("document-customer");
    const provider = await register("document-provider");
    const outsider = await register("document-outsider");
    const company = await createCompany(provider, {
      name: `Document Provider ${Math.random().toString(36).slice(2, 8)}`,
      type: "forwarder"
    });
    const rfq = await createRfq(customer, { recipientCompanyIds: [company.id] });
    expect(rfq.statusCode).toBe(200);

    const content = Buffer.from("%PDF-1.4\nPhase 5 test document\n%%EOF\n").toString("base64");
    const publicDocument = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(customer),
      payload: {
        type: "commercial_invoice",
        filename: "invoice.pdf",
        contentType: "application/pdf",
        size: Buffer.from(content, "base64").length,
        dataBase64: content,
        visibility: "providers"
      }
    });
    expect(publicDocument.statusCode).toBe(201);
    const publicDocumentBody = await json(publicDocument);
    expect(publicDocumentBody.storageKey).toBeUndefined();

    const privateDocument = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(customer),
      payload: {
        type: "other",
        filename: "private-notes.pdf",
        contentType: "application/pdf",
        size: Buffer.from(content, "base64").length,
        dataBase64: content,
        visibility: "private"
      }
    });
    expect(privateDocument.statusCode).toBe(201);
    const privateDocumentBody = await json(privateDocument);
    expect(privateDocumentBody.storageKey).toBeUndefined();

    const providerList = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(provider)
    });
    const providerListBody = await json(providerList);
    expect(providerListBody.items).toHaveLength(1);
    expect(providerListBody.items[0].id).toBe(publicDocumentBody.id);

    const providerPrivate = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents/${privateDocumentBody.id}`,
      headers: auth(provider)
    });
    expect(providerPrivate.statusCode).toBe(404);

    const providerPublic = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents/${publicDocumentBody.id}`,
      headers: auth(provider)
    });
    expect(providerPublic.statusCode).toBe(200);
    expect(providerPublic.headers["x-content-type-options"]).toBe("nosniff");

    const ownerPrivate = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents/${privateDocumentBody.id}`,
      headers: auth(customer)
    });
    expect(ownerPrivate.statusCode).toBe(200);

    const outsiderList = await app.inject({
      method: "GET",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(outsider)
    });
    expect(outsiderList.statusCode).toBe(403);

    const badType = await app.inject({
      method: "POST",
      url: `/api/v1/rfqs/${rfq.body.id}/documents`,
      headers: auth(customer),
      payload: {
        type: "other",
        filename: "payload.html",
        contentType: "text/html",
        size: 16,
        dataBase64: Buffer.from("<html>bad</html>").toString("base64"),
        visibility: "providers"
      }
    });
    expect(badType.statusCode).toBe(415);
  });
});
