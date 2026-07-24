import { NextResponse } from "next/server";

// Deprecated: replaced by /api/projects (Project > Folder > Photo).
export async function GET() {
  return NextResponse.json({ error: "Deprecated. Use /api/projects." }, { status: 410 });
}
