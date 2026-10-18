import { NextResponse } from "next/server";
import { currentMember } from "@/lib/session";
import { deleteSetting } from "@/lib/db";

export async function POST() {
  const member = await currentMember();
  if (member?.role !== "ADMIN") return NextResponse.json({ error: "Only a finance admin can do this." }, { status: 403 });
  // On a shared hosted demo the connection comes from the server's environment; one visitor shouldn't break it for everyone.
  if (process.env.PAYPAL_PAYMENT_TOKEN_ID) {
    return NextResponse.json({ error: "This demo's PayPal connection is set on the server and can't be disconnected here." }, { status: 409 });
  }
  for (const k of ["paypal_payment_token_id", "paypal_account_email", "paypal_customer_id", "paypal_connected_at"]) {
    deleteSetting(k);
  }
  return NextResponse.json({ ok: true });
}
