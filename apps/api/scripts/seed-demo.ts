/**
 * Demo data for a non-empty-looking platform.
 *
 * Creates five of each core record: provider organizations, users, companies,
 * company services, shipments, milestones, RFQs, quotes, quote items, bookings,
 * quotation requests, offers, documents, verification reviews, and audit rows.
 *
 * Every record is prefixed `demo-` by id and the company descriptions say
 * "بيانات تجريبية" so nobody mistakes it for real commercial data. Re-running
 * the script updates the same rows instead of creating duplicates.
 *
 *   pnpm --filter @naql/api db:seed:demo
 *
 * The customer organization is the first real (non-demo) account so the data is
 * visible when that user signs in. A non-local database requires `--yes`.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import "../src/config/env.js";

const prisma = new PrismaClient();
const db = prisma as any;

const DEMO_MARK = "بيانات تجريبية للعرض — ليست شركة حقيقية.";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function assertProductionConfirmation() {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!local && !process.argv.includes("--yes")) {
    throw new Error(
      `Refusing to write demo data to ${host} without confirmation. Re-run with --yes if this is intended.`
    );
  }
  return host;
}

const providerCompanies = [
  {
    id: "demo-company-1",
    name: "النيل الأزرق للشحن البحري",
    slug: "demo-nile-blue-shipping",
    type: "shipping",
    description: `${DEMO_MARK} خطوط شحن بحري بين الموانئ المصرية وموانئ الخليج.`,
    services: [
      { mode: "SEA", originLocation: "الإسكندرية", destinationLocation: "جدة", notes: "حاويات 20 و40 قدم" },
      { mode: "SEA", originLocation: "دمياط", destinationLocation: "الرياض", notes: "شحن كامل FCL" }
    ]
  },
  {
    id: "demo-company-2",
    name: "دلتا لوجيستيكس",
    slug: "demo-delta-logistics",
    type: "forwarder",
    description: `${DEMO_MARK} وكيل شحن وتخليص جمركي للشحنات البرية والبحرية.`,
    services: [
      { mode: "LAND", originLocation: "القاهرة", destinationLocation: "بورسعيد", notes: "نقل بري داخل مصر" },
      { mode: "MULTIMODAL", originLocation: "الإسكندرية", destinationLocation: "الرياض", notes: "بحري + بري" }
    ]
  },
  {
    id: "demo-company-3",
    name: "سما إير كارغو",
    slug: "demo-sky-air-cargo",
    type: "air",
    description: `${DEMO_MARK} شحن جوي سريع للبضائع الحساسة والمستلزمات الطبية.`,
    services: [
      { mode: "AIR", originLocation: "القاهرة", destinationLocation: "الرياض", notes: "خدمة 48 ساعة" },
      { mode: "AIR", originLocation: "برج العرب", destinationLocation: "جدة", notes: "شحن جزئي" }
    ]
  },
  {
    id: "demo-company-4",
    name: "الإسكندرية للتخليص الجمركي",
    slug: "demo-alexandria-customs",
    type: "customs",
    description: `${DEMO_MARK} إجراءات تخليص جمركي ومستندات استيراد وتصدير.`,
    services: [
      { mode: "SEA", originLocation: "الإسكندرية", destinationLocation: "الإسكندرية", notes: "تخليص واردات" },
      { mode: "AIR", originLocation: "القاهرة", destinationLocation: "القاهرة", notes: "تخليص شحن جوي" }
    ]
  },
  {
    id: "demo-company-5",
    name: "مخازن الدلتا",
    slug: "demo-delta-warehousing",
    type: "warehouse",
    description: `${DEMO_MARK} تخزين ومناولة بضائع ومستودعات جمركية.`,
    services: [
      { mode: "LAND", originLocation: "الدلتا", destinationLocation: "الإسكندرية", notes: "تخزين قصير الأمد" },
      { mode: "LAND", originLocation: "الدلتا", destinationLocation: "القاهرة", notes: "توزيع داخلي" }
    ]
  }
] as const;

const customerCompaniesForRfq = [1, 2, 3, 4, 5];

const shipmentSeed = [
  { id: "demo-shipment-1", reference: "SHP-DEMO-001", from: "ALY", to: "JED", mode: "SEA", incoterm: "CIF", cargo: "أثاث منزلي وقطع ديكور", weight: 12500, volume: 38, status: "IN_TRANSIT", days: 12 },
  { id: "demo-shipment-2", reference: "SHP-DEMO-002", from: "CAI", to: "RUH", mode: "AIR", incoterm: "FOB", cargo: "مستلزمات طبية", weight: 850, volume: 4.2, status: "DELIVERED", days: 20 },
  { id: "demo-shipment-3", reference: "SHP-DEMO-003", from: "DAM", to: "PSD", mode: "LAND", incoterm: "DAP", cargo: "ملابس جاهزة", weight: 6400, volume: 22, status: "BOOKED", days: 8 },
  { id: "demo-shipment-4", reference: "SHP-DEMO-004", from: "SUZ", to: "JED", mode: "SEA", incoterm: "CFR", cargo: "مواد بناء", weight: 22000, volume: 65, status: "CUSTOMS_CLEARANCE", days: 15 },
  { id: "demo-shipment-5", reference: "SHP-DEMO-005", from: "HBE", to: "RUH", mode: "AIR", incoterm: "DDP", cargo: "قطع غيار معدات", weight: 320, volume: 1.8, status: "QUOTATION_REQUESTED", days: 3 }
] as const;

const rfqSeed = [
  { id: "demo-rfq-1", origin: "الإسكندرية", destination: "جدة", mode: "SEA", cargo: "أثاث منزلي وقطع ديكور", weight: 12500, status: "accepted", days: 11, quoteBy: 1 },
  { id: "demo-rfq-2", origin: "القاهرة", destination: "الرياض", mode: "AIR", cargo: "مستلزمات طبية", weight: 850, status: "accepted", days: 19, quoteBy: 3 },
  { id: "demo-rfq-3", origin: "دمياط", destination: "بورسعيد", mode: "LAND", cargo: "ملابس جاهزة", weight: 6400, status: "accepted", days: 7, quoteBy: 2 },
  { id: "demo-rfq-4", origin: "السويس", destination: "جدة", mode: "SEA", cargo: "مواد بناء", weight: 22000, status: "accepted", days: 14, quoteBy: 1 },
  { id: "demo-rfq-5", origin: "برج العرب", destination: "الرياض", mode: "AIR", cargo: "قطع غيار معدات", weight: 320, status: "accepted", days: 2, quoteBy: 3 }
] as const;

const quoteSeed = [
  { id: "demo-quote-1", rfq: 1, company: 1, currency: "EGP", transit: 12, amount: 185000, days: 10, items: [["شحن بحري أساسي", 150000], ["مناولة في الميناء", 20000], ["تأمين الشحنة", 15000]], booking: "confirmed" },
  { id: "demo-quote-2", rfq: 2, company: 3, currency: "USD", transit: 4, amount: 4200, days: 18, items: [["شحن جوي", 3600], ["تغليف مبرد", 600]], booking: "confirmed" },
  { id: "demo-quote-3", rfq: 3, company: 2, currency: "EGP", transit: 3, amount: 45000, days: 6, items: [["نقل بري", 38000], ["تفريغ وتحميل", 7000]], booking: "requested" },
  { id: "demo-quote-4", rfq: 4, company: 1, currency: "EGP", transit: 18, amount: 310000, days: 13, items: [["شحن حاويات", 260000], ["رسوم ميناء", 30000], ["تأمين", 20000]], booking: "confirmed" },
  { id: "demo-quote-5", rfq: 5, company: 3, currency: "USD", transit: 3, amount: 1850, days: 1, items: [["شحن جوي سريع", 1600], ["مناولة أرضية", 250]], booking: "rejected" }
] as const;

async function findCustomer(): Promise<{ organizationId: string; userId: string }> {
  const preferred = await db.user.findFirst({
    where: { platformRole: null, organizationId: { not: null }, NOT: { email: { startsWith: "demo-" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, organizationId: true }
  });
  if (preferred?.organizationId) {
    return { organizationId: preferred.organizationId, userId: preferred.id };
  }

  const org = await db.organization.upsert({
    where: { id: "demo-org-customer" },
    update: {},
    create: { id: "demo-org-customer", name: "عميل تجريبي", slug: "demo-customer" }
  });
  const user = await db.user.upsert({
    where: { id: "demo-user-customer" },
    update: {},
    create: {
      id: "demo-user-customer",
      email: "demo-customer@naql.example",
      passwordHash: await bcrypt.hash(randomUUID(), 10),
      displayName: "عميل تجريبي",
      organizationId: org.id
    }
  });
  return { organizationId: org.id, userId: user.id };
}

async function findReviewer(): Promise<string | null> {
  const admin = await db.user.findFirst({
    where: { platformRole: { in: ["SUPER_ADMIN", "ADMIN", "REVIEWER"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true }
  });
  return admin?.id ?? null;
}

async function main() {
  const host = assertProductionConfirmation();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

  console.log(`Seeding demo data into ${host} ...`);

  const ports = await db.port.findMany({ select: { code: true, id: true } });
  const portId = new Map<string, string>(ports.map((p: any) => [p.code, p.id]));
  for (const code of new Set(shipmentSeed.flatMap((s) => [s.from, s.to]))) {
    if (!portId.has(code)) throw new Error(`Port ${code} is missing. Run "pnpm db:seed" first.`);
  }

  const customer = await findCustomer();
  const reviewerId = await findReviewer();
  const passwordHash = await bcrypt.hash(randomUUID(), 10);

  // ---------------------------------------------------------- provider users
  const companyUserIds: string[] = [];
  for (const [index, company] of providerCompanies.entries()) {
    const n = index + 1;
    const orgId = `demo-org-provider-${n}`;
    const userId = `demo-user-provider-${n}`;

    await db.organization.upsert({
      where: { id: orgId },
      update: { name: `${company.name} (تجريبي)` },
      create: { id: orgId, name: `${company.name} (تجريبي)`, slug: `demo-provider-${n}` }
    });

    await db.user.upsert({
      where: { id: userId },
      update: { displayName: `مسؤول ${company.name}` },
      create: {
        id: userId,
        email: `demo-provider-${n}@naql.example`,
        passwordHash,
        displayName: `مسؤول ${company.name}`,
        organizationId: orgId
      }
    });

    await db.membership.upsert({
      where: { id: `demo-membership-${n}` },
      update: { role: "ORG_ADMIN" },
      create: { id: `demo-membership-${n}`, organizationId: orgId, userId, role: "ORG_ADMIN" }
    });

    companyUserIds.push(userId);
  }

  // --------------------------------------------------------------- companies
  for (const [index, company] of providerCompanies.entries()) {
    const n = index + 1;
    const orgId = `demo-org-provider-${n}`;
    // Demo data must never claim verification. No secure company-document
    // upload exists yet, so every seeded company stays pending review.
    const verified = false;
    await db.company.upsert({
      where: { id: company.id },
      update: {
        name: company.name,
        type: company.type,
        description: company.description,
        status: verified ? "approved" : "needs_information",
        verificationStatus: verified ? "verified" : "pending",
        listed: true
      },
      create: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        type: company.type,
        status: verified ? "approved" : "needs_information",
        verificationStatus: verified ? "verified" : "pending",
        listed: true,
        description: company.description,
        country: "EG",
        email: `demo-provider-${n}@naql.example`,
        phone: `+20 100 000 000${n}`,
        organizationId: orgId,
        createdAt: daysAgo(30 - n)
      }
    });

    for (const [si, service] of company.services.entries()) {
      const serviceId = `demo-service-${n}-${si + 1}`;
      await db.companyService.upsert({
        where: { id: serviceId },
        update: { ...service },
        create: { id: serviceId, companyId: company.id, ...service }
      });
    }

    await db.companyDocument.upsert({
      where: { id: `demo-company-document-${n}` },
      update: {},
      create: {
        id: `demo-company-document-${n}`,
        companyId: company.id,
        type: "commercial_register",
        filename: `demo-company-${n}-commercial-register.pdf`,
        storageKey: `demo/company-${n}/commercial-register.pdf`,
        status: "metadata_only",
        uploadedAt: daysAgo(28 - n)
      }
    });

    if (reviewerId) {
      await db.verificationReview.upsert({
        where: { id: `demo-review-${n}` },
        update: { decision: verified ? "approved" : "needs_information", notes: verified ? "مراجعة تجريبية: بيانات مكتملة." : "مراجعة تجريبية: مطلوب تحديث السجل التجاري." },
        create: {
          id: `demo-review-${n}`,
          companyId: company.id,
          reviewerUserId: reviewerId,
          decision: verified ? "approved" : "needs_information",
          notes: verified ? "مراجعة تجريبية: بيانات مكتملة." : "مراجعة تجريبية: مطلوب تحديث السجل التجاري.",
          createdAt: daysAgo(25 - n)
        }
      });
    }
  }

  // --------------------------------------------------------------- shipments
  for (const [index, shipment] of shipmentSeed.entries()) {
    const n = index + 1;
    await db.shipment.upsert({
      where: { id: shipment.id },
      update: {
        status: shipment.status,
        cargoDescription: shipment.cargo,
        weightKg: shipment.weight,
        volumeCbm: shipment.volume
      },
      create: {
        id: shipment.id,
        reference: shipment.reference,
        organizationId: customer.organizationId,
        createdByUserId: customer.userId,
        originPortId: portId.get(shipment.from)!,
        destinationPortId: portId.get(shipment.to)!,
        mode: shipment.mode,
        incoterm: shipment.incoterm,
        status: shipment.status,
        cargoDescription: shipment.cargo,
        weightKg: shipment.weight,
        volumeCbm: shipment.volume,
        createdAt: daysAgo(shipment.days)
      }
    });

    const milestones = [
      ["BOOKED", "تم الحجز", "done"],
      ["DEPARTED", "غادرت ميناء المنشأ", n <= 3 ? "done" : "pending"],
      ["ARRIVED", "وصلت ميناء الوصول", n === 2 ? "done" : "pending"],
      ["DELIVERED", "تم التسليم", n === 2 ? "done" : "pending"]
    ] as const;
    for (const [mi, [code, label, status]] of milestones.entries()) {
      await db.shipmentMilestone.upsert({
        where: { id: `demo-milestone-${n}-${mi + 1}` },
        update: { status },
        create: {
          id: `demo-milestone-${n}-${mi + 1}`,
          shipmentId: shipment.id,
          code,
          label,
          status,
          occurredAt: status === "done" ? daysAgo(shipment.days - mi - 1) : null
        }
      });
    }

    await db.document.upsert({
      where: { id: `demo-document-${n}` },
      update: {},
      create: {
        id: `demo-document-${n}`,
        shipmentId: shipment.id,
        type: ["commercial_invoice", "packing_list", "bill_of_lading", "certificate_of_origin", "insurance"][index],
        filename: `demo-shipment-${n}-document.pdf`,
        storageKey: `demo/shipments/${n}/document.pdf`,
        status: "uploaded",
        uploadedAt: daysAgo(shipment.days - 1)
      }
    });

    await db.quotationRequest.upsert({
      where: { id: `demo-quotation-request-${n}` },
      update: { status: n <= 3 ? "awarded" : "open" },
      create: {
        id: `demo-quotation-request-${n}`,
        shipmentId: shipment.id,
        organizationId: customer.organizationId,
        status: n <= 3 ? "awarded" : "open",
        requestedAt: daysAgo(shipment.days - 1)
      }
    });

    await db.quotationOffer.upsert({
      where: { id: `demo-quotation-offer-${n}` },
      update: {},
      create: {
        id: `demo-quotation-offer-${n}`,
        quotationRequestId: `demo-quotation-request-${n}`,
        providerId: `demo-company-${(index % 5) + 1}`,
        currency: index % 2 === 0 ? "EGP" : "USD",
        amount: 25000 + index * 15000,
        transitDays: 4 + index * 2,
        validityUntil: daysFromNow(20)
      }
    });
  }

  // ------------------------------------------------------------------- RFQs
  for (const [index, rfq] of rfqSeed.entries()) {
    const n = index + 1;
    const recipientA = customerCompaniesForRfq[index];
    const recipientB = customerCompaniesForRfq[(index + 1) % 5];

    await db.rfq.upsert({
      where: { id: rfq.id },
      update: { status: rfq.status, cargoDescription: rfq.cargo, weightKg: rfq.weight },
      create: {
        id: rfq.id,
        organizationId: customer.organizationId,
        createdByUserId: customer.userId,
        origin: rfq.origin,
        destination: rfq.destination,
        mode: rfq.mode,
        cargoDescription: rfq.cargo,
        weightKg: rfq.weight,
        status: rfq.status,
        createdAt: daysAgo(rfq.days)
      }
    });

    for (const [ri, companyNumber] of [recipientA, recipientB].entries()) {
      await db.rfqRecipient.upsert({
        where: { id: `demo-recipient-${n}-${ri + 1}` },
        update: { status: companyNumber === rfq.quoteBy ? "quoted" : "invited" },
        create: {
          id: `demo-recipient-${n}-${ri + 1}`,
          rfqId: rfq.id,
          companyId: `demo-company-${companyNumber}`,
          status: companyNumber === rfq.quoteBy ? "quoted" : "invited",
          invitedAt: daysAgo(rfq.days)
        }
      });
    }
  }

  // ----------------------------------------------------------------- quotes
  const bookingSeed = [
    { status: "confirmed", externalReference: "BKG-DEMO-0001", confirmedDays: 8, events: [["PICKUP", "تم استلام الشحنة", "manual"], ["DEPARTED", "غادرت الميناء", "manual"], ["IN_TRANSIT", "الشحنة في الطريق", "manual"]] },
    { status: "confirmed", externalReference: "BKG-DEMO-0002", confirmedDays: 16, events: [["DELIVERED", "تم التسليم للمرسل إليه", "manual"]] },
    { status: "requested", externalReference: null, confirmedDays: null, events: [] },
    { status: "confirmed", externalReference: "BKG-DEMO-0003", confirmedDays: 12, events: [["DEPARTED", "غادرت السويس", "manual"], ["ARRIVED", "وصلت جدة", "manual"]] },
    { status: "rejected", externalReference: null, confirmedDays: null, events: [] }
  ] as const;

  for (const [index, quote] of quoteSeed.entries()) {
    const n = index + 1;
    const rfq = rfqSeed[quote.rfq - 1];
    await db.quote.upsert({
      where: { id: quote.id },
      update: { status: index === 4 ? "rejected" : "accepted", totalAmount: quote.amount },
      create: {
        id: quote.id,
        rfqId: `demo-rfq-${quote.rfq}`,
        companyId: `demo-company-${quote.company}`,
        organizationId: customer.organizationId,
        currency: quote.currency,
        totalAmount: quote.amount,
        transitDays: quote.transit,
        validityUntil: daysFromNow(14),
        status: index === 4 ? "rejected" : "accepted",
        createdAt: daysAgo(rfq.days - 1)
      }
    });

    for (const [ii, [label, amount]] of quote.items.entries()) {
      await db.quoteItem.upsert({
        where: { id: `demo-quote-item-${n}-${ii + 1}` },
        update: { amount },
        create: {
          id: `demo-quote-item-${n}-${ii + 1}`,
          quoteId: quote.id,
          label,
          amount,
          currency: quote.currency,
          included: true
        }
      });
    }
  }

  // --------------------------------------------------------------- bookings
  for (const [index, booking] of bookingSeed.entries()) {
    const n = index + 1;
    const quote = quoteSeed[index];
    await db.bookingRequest.upsert({
      where: { id: `demo-booking-${n}` },
      update: {
        status: booking.status,
        externalReference: booking.externalReference,
        confirmedAt: booking.confirmedDays ? daysAgo(booking.confirmedDays) : null
      },
      create: {
        id: `demo-booking-${n}`,
        rfqId: `demo-rfq-${quote.rfq}`,
        quoteId: quote.id,
        organizationId: customer.organizationId,
        createdByUserId: customer.userId,
        status: booking.status,
        externalReference: booking.externalReference,
        confirmedAt: booking.confirmedDays ? daysAgo(booking.confirmedDays) : null,
        rejectionReason: booking.status === "rejected" ? "لا توجد سعة متاحة على هذا المسار" : null,
        createdAt: daysAgo(quote.days)
      }
    });

    for (const [ei, [code, label, source]] of booking.events.entries()) {
      await db.trackingEvent.upsert({
        where: { id: `demo-tracking-${n}-${ei + 1}` },
        update: {},
        create: {
          id: `demo-tracking-${n}-${ei + 1}`,
          bookingRequestId: `demo-booking-${n}`,
          code,
          label,
          source,
          occurredAt: daysAgo((booking.confirmedDays ?? 1) - ei)
        }
      });
    }
  }

  // -------------------------------------------------------------- audit rows
  const auditSeed = [
    ["company.verify.approved", "Company", "demo-company-1"],
    ["company.verify.approved", "Company", "demo-company-2"],
    ["company.verify.approved", "Company", "demo-company-3"],
    ["quote.submit", "Quote", "demo-quote-1"],
    ["booking.confirmed", "BookingRequest", "demo-booking-1"]
  ] as const;
  for (const [index, [action, entityType, entityId]] of auditSeed.entries()) {
    const n = index + 1;
    await db.auditLog.upsert({
      where: { id: `demo-audit-${n}` },
      update: {},
      create: {
        id: `demo-audit-${n}`,
        organizationId: entityType === "Company" ? null : customer.organizationId,
        actorUserId: entityType === "Company" ? reviewerId : customer.userId,
        actorRole: entityType === "Company" ? "SUPER_ADMIN" : "customer",
        action,
        entityType,
        entityId,
        outcome: "success",
        metadata: JSON.stringify({ demo: true }),
        createdAt: daysAgo(20 - index)
      }
    });
  }

  console.log("Demo data ready:");
  console.log(`  provider organizations/users/companies: ${providerCompanies.length}`);
  console.log(`  shipments/documents/quotation requests: ${shipmentSeed.length}`);
  console.log(`  RFQs/quotes/bookings: ${rfqSeed.length}`);
  console.log(`  customer organization: ${customer.organizationId}`);
  console.log("Sign in as the customer account to see shipments, RFQs, quotations and bookings.");
  console.log("Company descriptions are labelled as demo data. Remove it with `--remove`.");
}

async function removeDemo() {
  const host = assertProductionConfirmation();
  console.log(`Removing demo data from ${host} ...`);

  // Children first; every statement is scoped to the deterministic demo ids.
  const ids = {
    trackingEvent: [1, 2, 3, 4].flatMap((b) => [1, 2, 3].map((e) => `demo-tracking-${b}-${e}`)),
    bookingRequest: [1, 2, 3, 4, 5].map((n) => `demo-booking-${n}`),
    quoteItem: [1, 2, 3, 4, 5].flatMap((q) => [1, 2, 3].map((i) => `demo-quote-item-${q}-${i}`)),
    quote: [1, 2, 3, 4, 5].map((n) => `demo-quote-${n}`),
    rfqRecipient: [1, 2, 3, 4, 5].flatMap((r) => [1, 2].map((i) => `demo-recipient-${r}-${i}`)),
    rfq: [1, 2, 3, 4, 5].map((n) => `demo-rfq-${n}`),
    quotationOffer: [1, 2, 3, 4, 5].map((n) => `demo-quotation-offer-${n}`),
    quotationRequest: [1, 2, 3, 4, 5].map((n) => `demo-quotation-request-${n}`),
    document: [1, 2, 3, 4, 5].map((n) => `demo-document-${n}`),
    shipmentMilestone: [1, 2, 3, 4, 5].flatMap((s) => [1, 2, 3, 4].map((m) => `demo-milestone-${s}-${m}`)),
    shipment: [1, 2, 3, 4, 5].map((n) => `demo-shipment-${n}`),
    verificationReview: [1, 2, 3, 4, 5].map((n) => `demo-review-${n}`),
    companyDocument: [1, 2, 3, 4, 5].map((n) => `demo-company-document-${n}`),
    companyService: [1, 2, 3, 4, 5].flatMap((c) => [1, 2].map((s) => `demo-service-${c}-${s}`)),
    company: [1, 2, 3, 4, 5].map((n) => `demo-company-${n}`),
    membership: [1, 2, 3, 4, 5].map((n) => `demo-membership-${n}`),
    user: [1, 2, 3, 4, 5].map((n) => `demo-user-provider-${n}`).concat("demo-user-customer"),
    organization: [1, 2, 3, 4, 5].map((n) => `demo-org-provider-${n}`).concat("demo-org-customer"),
    auditLog: [1, 2, 3, 4, 5].map((n) => `demo-audit-${n}`)
  };
  for (const [table, values] of Object.entries(ids)) {
    const result = await db[table].deleteMany({ where: { id: { in: values } } });
    if (result.count) console.log(`  removed ${result.count} ${table}`);
  }
  console.log("Demo data removed.");
}

const run = process.argv.includes("--remove") ? removeDemo : main;
run()
  .catch((error) => {
    console.error(`demo seed failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
