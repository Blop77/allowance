import "server-only";
import {
  committedThisMonthCents,
  getCategoryRule,
  getPurchase,
  getSearchResult,
  getSetting,
  getTeam,
  insertPurchase,
  newId,
  now,
  updatePurchase,
  type Member,
  type Purchase,
} from "./db";
import { evaluatePolicy, type PolicyResult } from "./policy";
import { chargeVaultedAccount, PayPalError } from "./paypal";

// Every path that can move money goes through this file. The agent never sets a price,
// a status, or a decision: it only passes a search result id it was shown.

export function policyForResult(member: Member, resultId: string, excludePurchaseId?: string) {
  const result = getSearchResult(resultId);
  if (!result) return { error: `No search result with id ${resultId}.` } as const;
  const team = getTeam(member.team_id)!;
  const policy = evaluatePolicy({
    amountCents: result.price_cents,
    category: result.category,
    team,
    committedThisMonthCents: committedThisMonthCents(team.id, excludePurchaseId),
    rule: getCategoryRule(result.category),
  });
  return { result, team, policy } as const;
}

export function vaultId(): string | undefined {
  return getSetting("paypal_payment_token_id");
}

export async function placeOrder(member: Member, resultId: string, justification: string) {
  const checked = policyForResult(member, resultId);
  if ("error" in checked) return { error: checked.error };
  const { result, team, policy } = checked;

  const base: Purchase = {
    id: newId("pur"),
    member_id: member.id,
    team_id: team.id,
    search_result_id: result.id,
    title: result.title,
    merchant: result.merchant,
    url: result.url,
    image_url: result.image_url,
    category: result.category,
    amount_cents: result.price_cents,
    currency: result.currency,
    status: "REFUSED",
    reason: policy.reasons.join(" "),
    justification: justification.slice(0, 500),
    paypal_order_id: null,
    paypal_capture_id: null,
    paypal_status: null,
    decided_by: null,
    created_at: now(),
    updated_at: now(),
  };

  if (policy.decision === "REFUSE") {
    insertPurchase({ ...base, status: "REFUSED", decided_by: "policy" });
    return { purchase: getPurchase(base.id)!, policy };
  }
  if (policy.decision === "NEEDS_APPROVAL") {
    insertPurchase({ ...base, status: "PENDING_APPROVAL" });
    return { purchase: getPurchase(base.id)!, policy };
  }

  insertPurchase({ ...base, status: "PENDING_APPROVAL", decided_by: "policy" });
  const paid = await pay(base.id, team.name);
  return { purchase: paid, policy };
}

/** Charge the company's vaulted PayPal account for a purchase that has been approved. */
async function pay(purchaseId: string, teamName: string): Promise<Purchase> {
  const purchase = getPurchase(purchaseId)!;
  const vault = vaultId();
  if (!vault) {
    updatePurchase(purchaseId, {
      status: "FAILED",
      reason: "The company PayPal account is not connected yet. An admin can connect it on the Admin page.",
    });
    return getPurchase(purchaseId)!;
  }
  try {
    const charge = await chargeVaultedAccount({
      vaultId: vault,
      purchaseId,
      amountCents: purchase.amount_cents,
      currency: purchase.currency,
      description: `${teamName}: ${purchase.title}`,
      teamName,
    });
    const ok = charge.captureStatus === "COMPLETED" || charge.captureStatus === "PENDING";
    updatePurchase(purchaseId, {
      status: ok ? "PAID" : "FAILED",
      paypal_order_id: charge.orderId,
      paypal_capture_id: charge.captureId,
      paypal_status: charge.captureStatus ?? charge.orderStatus,
      reason: ok ? purchase.reason : `PayPal returned order status ${charge.orderStatus}.`,
    });
  } catch (err) {
    const message = err instanceof PayPalError ? err.message : String(err);
    updatePurchase(purchaseId, { status: "FAILED", reason: `PayPal payment failed: ${message}` });
  }
  return getPurchase(purchaseId)!;
}

export async function decide(purchaseId: string, manager: Member, action: "approve" | "decline") {
  const purchase = getPurchase(purchaseId);
  if (!purchase) return { error: "Purchase not found." };
  if (purchase.status !== "PENDING_APPROVAL") return { error: "This purchase is not waiting for approval." };
  if (manager.role !== "ADMIN" && !(manager.role === "MANAGER" && manager.team_id === purchase.team_id)) {
    return { error: "Only this team's manager or a finance admin can decide." };
  }
  const team = getTeam(purchase.team_id)!;

  if (action === "decline") {
    updatePurchase(purchaseId, { status: "DECLINED", decided_by: manager.name, reason: `Declined by ${manager.name}.` });
    return { purchase: getPurchase(purchaseId)! };
  }

  // Re-check every rule except the approval threshold at decision time: budgets may have changed since the request.
  const recheck: PolicyResult = evaluatePolicy({
    amountCents: purchase.amount_cents,
    category: purchase.category,
    team: { ...team, approval_threshold_cents: Number.MAX_SAFE_INTEGER },
    committedThisMonthCents: committedThisMonthCents(team.id, purchase.id),
    rule: getCategoryRule(purchase.category),
  });
  if (recheck.decision === "REFUSE") {
    updatePurchase(purchaseId, { status: "REFUSED", decided_by: "policy", reason: recheck.reasons.join(" ") });
    return { purchase: getPurchase(purchaseId)! };
  }
  updatePurchase(purchaseId, { decided_by: manager.name, reason: `Approved by ${manager.name}.` });
  return { purchase: await pay(purchaseId, team.name) };
}
