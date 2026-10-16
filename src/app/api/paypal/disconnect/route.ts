import { NextResponse } from "next/server";
import { currentMember } from "@/lib/session";
import { deleteSetting } from "@/lib/db";

export async function POST() {
  const member = await currentMember();
  if (member?.role !== "ADMIN") return NextResponse.json({ error: "Only a finance admin can do this." }, { status: 403 });
  for (const k of ["paypal_payment_token_id", "paypal_account_email", "paypal_customer_id", "paypal_connected_at"]) {
    deleteSetting(k);
  }
  return NextResponse.json({ ok: true });
}
