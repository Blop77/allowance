import { NextResponse } from "next/server";
import { currentMember } from "@/lib/session";
import { decide } from "@/lib/purchasing";

export async function POST(req: Request) {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "Pick a persona first." }, { status: 401 });
  const { purchaseId, action } = (await req.json()) as { purchaseId?: string; action?: "approve" | "decline" };
  if (!purchaseId || (action !== "approve" && action !== "decline")) {
    return NextResponse.json({ error: "purchaseId and a valid action are required." }, { status: 400 });
  }
  const out = await decide(purchaseId, member, action);
  if ("error" in out) return NextResponse.json(out, { status: 400 });
  return NextResponse.json(out);
}
