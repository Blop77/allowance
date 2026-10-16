import { NextResponse } from "next/server";
import { createVaultPaymentToken, PayPalError } from "@/lib/paypal";
import { deleteSetting, getSetting, now, setSetting } from "@/lib/db";
import { appUrl } from "@/lib/url";

// PayPal redirects here after the admin approves saving the account.
export async function GET(req: Request) {
  const base = appUrl(req);
  const url = new URL(req.url);
  const setupTokenId = url.searchParams.get("approval_token_id") ?? getSetting("paypal_pending_setup_token");
  if (!setupTokenId || setupTokenId !== getSetting("paypal_pending_setup_token")) {
    return NextResponse.redirect(`${base}/admin?paypal=error&message=${encodeURIComponent("Unknown setup token.")}`);
  }
  try {
    const token = await createVaultPaymentToken(setupTokenId);
    setSetting("paypal_payment_token_id", token.paymentTokenId);
    if (token.email) setSetting("paypal_account_email", token.email);
    if (token.customerId) setSetting("paypal_customer_id", token.customerId);
    setSetting("paypal_connected_at", now());
    deleteSetting("paypal_pending_setup_token");
    return NextResponse.redirect(`${base}/admin?paypal=connected`);
  } catch (err) {
    const msg = err instanceof PayPalError ? err.message : String(err);
    console.error("PayPal payment token failed", err instanceof PayPalError ? JSON.stringify(err.details) : err);
    return NextResponse.redirect(`${base}/admin?paypal=error&message=${encodeURIComponent(msg)}`);
  }
}
