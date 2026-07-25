// Dumps every row from every table in the (Neon) production database to a
// single timestamped JSON file -- an independent backup on top of Neon's
// own point-in-time recovery. Run with the production DATABASE_URL, e.g.:
//   DATABASE_URL="postgresql://...neon..." npx tsx scripts/backup-to-json.ts /path/to/backups/dir
//
// Never run this against the local dev.db on purpose -- it's meant for the
// real Neon database, pointed at via a temporary DATABASE_URL override.
import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const outDir = process.argv[2] || ".";
  fs.mkdirSync(outDir, { recursive: true });

  const [projects, folders, photos, projectAreas, folderPresets, users, passkeys] = await Promise.all([
    prisma.project.findMany(),
    prisma.folder.findMany(),
    prisma.photo.findMany(),
    prisma.projectArea.findMany(),
    prisma.folderPreset.findMany(),
    // Never include passwordHash in a backup file that might end up
    // somewhere less locked-down than the database itself.
    prisma.user.findMany({ select: { id: true, username: true, name: true, createdAt: true } }),
    prisma.passkey.findMany({ select: { id: true, userId: true, deviceType: true, label: true, createdAt: true } }),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    app: "primecore-field-photos",
    counts: {
      projects: projects.length,
      folders: folders.length,
      photos: photos.length,
      projectAreas: projectAreas.length,
      folderPresets: folderPresets.length,
      users: users.length,
      passkeys: passkeys.length,
    },
    projects,
    folders,
    photos,
    projectAreas,
    folderPresets,
    users,
    passkeys,
  };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `field-photos-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2));
  console.log(`Wrote ${outPath} (${photos.length} photos, ${projects.length} projects)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
