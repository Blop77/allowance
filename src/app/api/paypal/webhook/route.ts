import { NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/paypal";
import { getPurchase, recordWebhookEvent, updatePurchase } from "@/lib/db";

interface WebhookEvent {
  id: string;
  event_type: string;
  resource?: { id?: string; status?: string; custom_id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
}

// PayPal tells us what actually settled. The ledger trusts this over the API response.
export async function POST(req: Request) {
  const event = (await req.json()) as WebhookEvent;
  if (!(await verifyWebhook(req.headers, event))) {
    return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
  }
  if (!recordWebhookEvent(event.id, event.event_type, event.resource?.id ?? null)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const purchaseId = event.resource?.custom_id;
  const purchase = purchaseId ? getPurchase(purchaseId) : undefined;
  if (purchase) {
    switch (event.event_type) {
      case "PAYMENT.CAPTURE.COMPLETED":
        updatePurchase(purchase.id, { status: "PAID", paypal_capture_id: event.resource!.id ?? null, paypal_status: "COMPLETED" });
        break;
      case "PAYMENT.CAPTURE.DENIED":
      case "PAYMENT.CAPTURE.DECLINED":
        updatePurchase(purchase.id, { status: "FAILED", paypal_status: event.resource?.status ?? "DENIED", reason: "PayPal denied the payment." });
        break;
      case "PAYMENT.CAPTURE.REFUNDED":
        updatePurchase(purchase.id, { paypal_status: "REFUNDED" });
        break;
      case "PAYMENT.CAPTURE.PENDING":
        updatePurchase(purchase.id, { paypal_status: "PENDING" });
        break;
    }
  }
  return NextResponse.json({ ok: true });
}
