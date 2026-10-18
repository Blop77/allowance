import { NextResponse } from "next/server";
import { resetDemo } from "@/lib/db";

// Anyone can reset the shared demo (there are no real accounts). The PayPal connection is kept.
export async function POST() {
  resetDemo();
  return NextResponse.json({ ok: true });
}
