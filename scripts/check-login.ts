// Login troubleshooting tool for Field Photos (run on your own computer).
// Checks whether an account exists, whether it's active, and whether the
// password you type matches. If it doesn't match, it offers to reset the
// password to what you typed (asks first -- nothing changes unless you
// answer "y"). Uses the same hashing as the app (lib/password.ts).
//
// Usage:
//   npx tsx scripts/check-login.ts rasiel

import { PrismaClient } from "@prisma/client";
import readline from "readline";
import { hashPassword, verifyPassword } from "../lib/password";

const prisma = new PrismaClient();

function ask(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: npx tsx scripts/check-login.ts <username>");
    process.exit(1);
  }
  // The login form lowercases + trims the username, so do the same here.
  const username = raw.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) {
    const all = await prisma.user.findMany({ select: { username: true, active: true } });
    console.log(`\nNo Field Photos account named "${username}".`);
    console.log("Accounts that exist:", all.map((u) => `${u.username}${u.active ? "" : " (inactive)"}`).join(", ") || "(none)");
    return;
  }

  console.log(`\nAccount "${user.username}" found.`);
  console.log(`  Active: ${user.active ? "yes" : "NO -- access was removed, login will always fail"}`);
  console.log(`  Admin:  ${user.isAdmin ? "yes" : "no"}`);

  const pw = await ask("\nType the password you are trying to use: ");
  if (verifyPassword(pw, user.passwordHash)) {
    console.log("Password MATCHES.");
  } else {
    console.log("Password does NOT match.");
    const yn = await ask("Reset this account's password to what you just typed? (y/n): ");
    if (yn.trim().toLowerCase() === "y") {
      if (pw.length < 4) { console.log("Password must be at least 4 characters. Nothing changed."); }
      else {
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(pw) } });
        console.log("Password updated.");
      }
    } else {
      console.log("Nothing changed.");
    }
  }

  if (!user.active) {
    const yn = await ask("\nRe-activate this account? (y/n): ");
    if (yn.trim().toLowerCase() === "y") {
      await prisma.user.update({ where: { id: user.id }, data: { active: true } });
      console.log("Account re-activated.");
    } else {
      console.log("Left inactive.");
    }
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
