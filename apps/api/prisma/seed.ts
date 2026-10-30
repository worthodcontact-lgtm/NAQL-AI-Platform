import { PrismaClient } from "@prisma/client";
// Loads the repository root .env (and protects against remote test databases).
import "../src/config/env.js";

const prisma = new PrismaClient();

/**
 * Idempotent reference-data seed.
 *
 * Coordinates are publicly published approximate port/airport positions. They are
 * explicitly labelled `approximate` and never presented as survey-grade or official
 * records. No live prices, schedules, or government data are seeded.
 */
const SOURCE = "Publicly published approximate location; not an official survey record.";

type SeedPort = {
  code: string;
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  type: "seaport" | "airport" | "inland" | "border";
};

const ports: SeedPort[] = [
  // Egypt — seaports (primary market)
  { code: "ALY", name: "Alexandria Port", country: "EG", latitude: 31.2001, longitude: 29.8853, type: "seaport" },
  { code: "DEK", name: "El Dekheila Port", country: "EG", latitude: 31.1415, longitude: 29.793, type: "seaport" },
  { code: "DAM", name: "Damietta Port", country: "EG", latitude: 31.442, longitude: 31.79, type: "seaport" },
  { code: "PSD", name: "Port Said", country: "EG", latitude: 31.2653, longitude: 32.3019, type: "seaport" },
  { code: "EPS", name: "East Port Said", country: "EG", latitude: 31.2472, longitude: 32.3206, type: "seaport" },
  { code: "SUZ", name: "Suez Port", country: "EG", latitude: 29.95, longitude: 32.55, type: "seaport" },
  { code: "ADA", name: "Adabiya Port", country: "EG", latitude: 29.8711, longitude: 32.4931, type: "seaport" },
  { code: "SOK", name: "Ain Sokhna Port", country: "EG", latitude: 29.6009, longitude: 32.3315, type: "seaport" },
  { code: "SFA", name: "Safaga Port", country: "EG", latitude: 26.7509, longitude: 33.9358, type: "seaport" },
  { code: "ABQ", name: "Abu Qir Port", country: "EG", latitude: 31.3167, longitude: 30.0667, type: "seaport" },
  { code: "ARI", name: "El Arish Port", country: "EG", latitude: 31.1314, longitude: 33.8022, type: "seaport" },
  { code: "NUW", name: "Nuweiba Port", country: "EG", latitude: 28.9667, longitude: 34.6667, type: "seaport" },

  // Egypt — airports
  { code: "CAI", name: "Cairo International Airport (cargo)", country: "EG", latitude: 30.1114, longitude: 31.4139, type: "airport" },
  { code: "HBE", name: "Alexandria Borg El Arab Airport", country: "EG", latitude: 30.9177, longitude: 29.6964, type: "airport" },
  { code: "HRG", name: "Hurghada International Airport", country: "EG", latitude: 27.1783, longitude: 33.7994, type: "airport" },
  { code: "SSH", name: "Sharm El Sheikh International Airport", country: "EG", latitude: 27.9773, longitude: 34.3947, type: "airport" },
  { code: "LXR", name: "Luxor International Airport", country: "EG", latitude: 25.6708, longitude: 32.7066, type: "airport" },

  // Egypt — inland terminals
  { code: "ODP", name: "6th of October Dry Port", country: "EG", latitude: 29.9285, longitude: 30.905, type: "inland" },

  // Existing reference entries (preserved)
  { code: "JED", name: "Jeddah Islamic Port", country: "SA", latitude: 21.4858, longitude: 39.1925, type: "seaport" },
  { code: "RUH", name: "King Khalid International Airport (cargo)", country: "SA", latitude: 24.9576, longitude: 46.6988, type: "airport" }
];

/**
 * Public directory candidates for major ocean carriers.
 *
 * These are real international shipping lines. The record only claims what can
 * be checked from a public corporate source: the company identity and official
 * website. It does not claim an Egyptian office, local agent, port coverage,
 * capacity, or a live rate/availability integration. `lastVerifiedAt` remains
 * null because this seed is not an independent verification review.
 */
const shippingLines = [
  { slug: "maersk", name: "Maersk", nameEn: "A.P. Moller - Maersk", country: "DK", website: "https://www.maersk.com" },
  { slug: "msc", name: "Mediterranean Shipping Company (MSC)", nameEn: "Mediterranean Shipping Company", country: "CH", website: "https://www.msc.com" },
  { slug: "cma-cgm", name: "CMA CGM", nameEn: "CMA CGM", country: "FR", website: "https://www.cma-cgm.com" },
  { slug: "wan-hai", name: "Wan Hai Lines", nameEn: "Wan Hai Lines", country: "TW", website: "https://www.wanhai.com" },
  { slug: "hapag-lloyd", name: "Hapag-Lloyd", nameEn: "Hapag-Lloyd", country: "DE", website: "https://www.hapag-lloyd.com" },
  { slug: "cosco-shipping-lines", name: "COSCO Shipping Lines", nameEn: "COSCO Shipping Lines", country: "CN", website: "https://lines.coscoshipping.com" },
  { slug: "evergreen-marine", name: "Evergreen Marine", nameEn: "Evergreen Marine Corporation", country: "TW", website: "https://www.evergreen-marine.com" },
  { slug: "one", name: "Ocean Network Express (ONE)", nameEn: "Ocean Network Express", country: "SG", website: "https://www.one-line.com" },
  { slug: "yang-ming", name: "Yang Ming", nameEn: "Yang Ming Marine Transport Corporation", country: "TW", website: "https://www.yangming.com" },
  { slug: "zim", name: "ZIM", nameEn: "ZIM Integrated Shipping Services", country: "IL", website: "https://www.zim.com" },
  { slug: "arkas-line", name: "Arkas Line", nameEn: "Arkas Line", country: "TR", website: "https://www.arkasline.com" }
] as const;

async function seedDirectory() {
  let created = 0;
  let updated = 0;
  for (const line of shippingLines) {
    const data = {
      name: line.name,
      nameEn: line.nameEn,
      slug: line.slug,
      type: "shipping",
      status: "directory_candidate",
      verificationStatus: "unverified",
      listed: true,
      description:
        "International ocean carrier listed as a public directory candidate. Egyptian agency representation, service coverage, capacity, prices and availability are not verified by NAQL AI.",
      country: line.country,
      website: line.website,
      organizationId: null,
      recordOrigin: "manually_entered",
      dataSource: "Official public corporate website; directory candidate only",
      sourceUrl: line.website,
      lastVerifiedAt: null,
      publicContactConsent: false,
      pricingIntegrationStatus: "NOT_CONFIGURED",
      availabilityIntegrationStatus: "NOT_CONFIGURED"
    };
    const existing = await prisma.company.findUnique({ where: { slug: line.slug } });
    if (existing?.organizationId) {
      // Never overwrite a real registered company that happens to share a slug.
      continue;
    }
    if (existing) {
      await prisma.company.update({ where: { slug: line.slug }, data });
      updated += 1;
    } else {
      await prisma.company.create({ data });
      created += 1;
    }
  }
  return { created, updated };
}

async function main() {
  let created = 0;
  let updated = 0;

  for (const port of ports) {
    const existing = await prisma.port.findUnique({ where: { code: port.code } });
    if (existing) {
      await prisma.port.update({
        where: { code: port.code },
        data: {
          name: port.name,
          country: port.country,
          type: port.type,
          source: SOURCE,
          ...(existing.verificationStatus === "unverified" ? { verificationStatus: "approximate" } : {})
        }
      });
      updated += 1;
    } else {
      await prisma.port.create({
        data: { ...port, source: SOURCE, verificationStatus: "approximate" }
      });
      created += 1;
    }
  }

  const directory = await seedDirectory();
  const total = await prisma.port.count();
  console.log(
    `Seed complete: ${created} ports created, ${updated} ports updated, ${total} ports total.`
  );
  console.log(
    `Directory candidates: ${directory.created} created, ${directory.updated} updated; unverified and integration-free.`
  );
  console.log("Note: coordinates are approximate and labelled as such; no live or official data is seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
