import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const area = await prisma.projectArea.findUnique({ where: { id } });
  if (!area) {
    return NextResponse.json({ ok: true });
  }

  // Yard and House are the fixed default areas every project gets -- they
  // can't be deleted (only custom sites can), even if a request slips past
  // the UI (which already hides the Delete button for them).
  if (area.name === "Yard" || area.name === "House") {
    return NextResponse.json({ error: "Yard and House can't be deleted." }, { status: 400 });
  }

  // Folder.area is just a matching string, not a foreign key to
  // ProjectArea, so removing the site also removes any folders (and their
  // photos, via Folder's own cascade) filed under that area name.
  await prisma.folder.deleteMany({ where: { projectId: area.projectId, area: area.name } });
  await prisma.projectArea.delete({ where: { id } }).catch(() => null);

  return NextResponse.json({ ok: true });
}
