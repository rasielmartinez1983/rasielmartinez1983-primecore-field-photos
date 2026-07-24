import { NextResponse } from "next/server";

// Deprecated: replaced by /api/projects/[id].
export async function GET() {
  return NextResponse.json({ error: "Deprecated. Use /api/projects/[id]." }, { status: 410 });
}
