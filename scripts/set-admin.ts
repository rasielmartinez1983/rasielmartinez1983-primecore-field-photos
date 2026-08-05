// One-time bootstrap tool: marks one existing account as admin (full
// access, including /admin -- generating/revoking access codes,
// activating/deactivating other accounts). This can't be done from
// inside the app itself on purpose, since granting admin is the one
// thing nobody except an existing admin should ever be able to do -- and
// before this script runs, there ISN'T one yet.
//
// Usage:
//   npx tsx scripts/set-admin.ts <username>
//
// Example:
//   npx tsx scripts/set-admin.ts rasiel
//
// Run this once, for your own account (the one you already use today --
// see README for how it was created), right after `npm run db:push`.
// Nobody else needs this -- once you're admin, use the Admin page in the
// app (top-right "Admin" link) to generate access codes for anyone else.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const [username] = process.argv.slice(2);

  if (!username) {
    console.error("Usage: npx tsx scripts/set-admin.ts <username>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    console.error(`No account found with username "${username}".`);
    console.error("Sign in (or create an account) with that username first, then run this again.");
    process.exit(1);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { isAdmin: true },
  });

  console.log(`${user.name || user.username} (${username}) is now an admin.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
