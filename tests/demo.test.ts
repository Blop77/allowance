import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Point the app at a throwaway database before loading it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "allowance-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
delete process.env.PAYPAL_PAYMENT_TOKEN_ID;

// Loaded lazily so the environment above is in place first (this project compiles to CommonJS, so no top-level await).
const app = async () => ({ ...(await import("../src/lib/db")), ...(await import("../src/lib/purchasing")) });

async function giftCardResult() {
  const { insertSearchResult, newId, now } = await app();
  const id = newId("res");
  insertSearchResult({
    id, conversation_id: "c1", title: "$100 Gift Card", merchant: "example.com", url: "https://example.com",
    image_url: null, price_cents: 10000, currency: "USD", category: "gift_cards", source: "sample", created_at: now(),
  });
  return id;
}

test("a refused request is logged once, whether it came from check_policy or place_order", async () => {
  const { getMember, getPurchases, placeOrder, policyForResult, recordRefusal } = await app();
  const priya = getMember("priya")!;
  const resultId = await giftCardResult();
  const checked = policyForResult(priya, resultId);
  assert.ok(!("error" in checked));
  if ("error" in checked) return;
  assert.equal(checked.policy.decision, "REFUSE");

  const first = recordRefusal(priya, checked, "check");
  const again = recordRefusal(priya, checked, "check");
  const ordered = await placeOrder(priya, resultId, "order");
  assert.ok(!("error" in ordered));
  assert.equal(again.id, first.id);
  if (!("error" in ordered)) assert.equal(ordered.purchase.id, first.id);

  const refused = getPurchases({ status: "REFUSED" });
  assert.equal(refused.length, 1);
  assert.equal(refused[0].decided_by, "policy");
});

test("resetDemo restores rules and empties the ledger but keeps the PayPal connection", async () => {
  const { db, getMember, getPurchases, getSetting, getTeam, resetDemo, setSetting } = await app();
  setSetting("paypal_payment_token_id", "tok_keep");
  db().prepare("UPDATE teams SET monthly_budget_cents = 1 WHERE id = 'design'").run();
  assert.ok(getPurchases().length > 0);

  resetDemo();

  assert.equal(getPurchases().length, 0);
  assert.equal(getTeam("design")!.monthly_budget_cents, 200000);
  assert.ok(getMember("priya"));
  assert.equal(getSetting("paypal_payment_token_id"), "tok_keep");
});
