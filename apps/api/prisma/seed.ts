import { PrismaClient } from "@prisma/client";

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

async function main() {
  let created = 0;
  let updated = 0;

  for (const port of ports) {
    const existing = await prisma.port.findUnique({ where: { code: port.code } });
    if (existing) {
      await prisma.port.update({
        where: { code: port.code },
        data: { name: port.name, country: port.country, type: port.type, source: SOURCE }
      });
      updated += 1;
    } else {
      await prisma.port.create({
        data: { ...port, source: SOURCE, verificationStatus: "approximate" }
      });
      created += 1;
    }
  }

  const total = await prisma.port.count();
  console.log(`Seed complete: ${created} created, ${updated} updated, ${total} ports total.`);
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
