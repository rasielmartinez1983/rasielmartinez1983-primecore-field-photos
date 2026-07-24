import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Starter list of folder-name presets, taken from the real AMP folder
// structure already used on OneDrive (Bandit - 2024 New Solar Substation).
// These show up as quick-pick buttons when creating a folder in any
// project; any new custom name a tech types gets added to this same list
// automatically (see app/api/folders/route.ts).
const YARD_PRESETS = [
  "Arresters",
  "Breakers",
  "CCVTs 161kV",
  "CTs",
  "GSU",
  "PTs",
  "Station Service",
  "Switches",
  "Tuning Units",
  "Wave Traps",
];

const HOUSE_PRESETS = [
  "Batteries and Chargers",
  "Load Centers",
  "Panel (PL-)",
  "Panel (PU-)",
  "Panel A4 (PB-0855)",
  "Panel (PX-)",
  "Panel (PD-)",
  "Panel (PH-)",
  "Panel A9 (PC-0429)",
  "Panel (FF-)",
  "Panel (Relay Rack)",
  "Panel A12 (Solar)",
  "Supervisory (S-)",
];

async function main() {
  let count = 0;
  for (const name of YARD_PRESETS) {
    await prisma.folderPreset.upsert({
      where: { area_name: { area: "Yard", name } },
      update: {},
      create: { area: "Yard", name },
    });
    count++;
  }
  for (const name of HOUSE_PRESETS) {
    await prisma.folderPreset.upsert({
      where: { area_name: { area: "House", name } },
      update: {},
      create: { area: "House", name },
    });
    count++;
  }
  console.log(`Seeded ${count} folder presets.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
