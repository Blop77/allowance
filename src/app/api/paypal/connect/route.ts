import { NextResponse } from "next/server";
import { currentMember } from "@/lib/session";
import { createVaultSetupToken, PayPalError, paypalConfigured } from "@/lib/paypal";
import { setSetting } from "@/lib/db";
import { appUrl } from "@/lib/url";

// Admin clicks "Connect company PayPal": create a Vault setup token and send them to PayPal to approve it.
export async function GET(req: Request) {
  const base = appUrl(req);
  const member = await currentMember();
  if (member?.role !== "ADMIN") return NextResponse.redirect(`${base}/admin?paypal=forbidden`);
  if (!paypalConfigured()) return NextResponse.redirect(`${base}/admin?paypal=not_configured`);
  try {
    const { setupTokenId, approveUrl } = await createVaultSetupToken(
      `${base}/api/paypal/return`,
      `${base}/admin?paypal=cancelled`,
    );
    setSetting("paypal_pending_setup_token", setupTokenId);
    return NextResponse.redirect(approveUrl);
  } catch (err) {
    const msg = err instanceof PayPalError ? err.message : String(err);
    console.error("PayPal setup token failed", err instanceof PayPalError ? JSON.stringify(err.details) : err);
    return NextResponse.redirect(`${base}/admin?paypal=error&message=${encodeURIComponent(msg)}`);
  }
}
