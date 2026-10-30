import { runRetention } from "../src/documents/retention.js";

/**
 * Retention cleanup is dry-run by default. Use `--apply` only after reviewing
 * the report and confirming the configured retention windows.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;
  const report = await runRetention({ apply, limit });
  console.log(JSON.stringify(report, null, 2));
  if (report.documents.errors > 0 || report.companyDocuments.errors > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../src/db.js");
    await prisma?.$disconnect();
  });
