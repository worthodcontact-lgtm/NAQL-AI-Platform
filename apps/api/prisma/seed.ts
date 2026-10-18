import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  await prisma.port.upsert({
    where: { code: "JED" },
    update: {},
    create: { code: "JED", name: "Jeddah Islamic Port", country: "SA", latitude: 21.4858, longitude: 39.1925 }
  });
  await prisma.port.upsert({
    where: { code: "RUH" },
    update: {},
    create: { code: "RUH", name: "King Khalid International Airport (cargo)", country: "SA", latitude: 24.9576, longitude: 46.6988 }
  });
  console.log("Seed completed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
