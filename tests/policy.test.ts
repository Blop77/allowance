import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluatePolicy } from "../src/lib/policy";

const team = { name: "Design", monthly_budget_cents: 200000, approval_threshold_cents: 30000 };
const hardware = { label: "Hardware & electronics", max_item_cents: 80000, blocked: 0 };

test("auto-approves an in-policy purchase under the threshold", () => {
  const r = evaluatePolicy({ amountCents: 28999, category: "hardware", team, committedThisMonthCents: 0, rule: hardware });
  assert.equal(r.decision, "AUTO_APPROVE");
  assert.equal(r.remainingAfterCents, 200000 - 28999);
});

test("sends purchases above the threshold to the manager", () => {
  const r = evaluatePolicy({ amountCents: 51999, category: "hardware", team, committedThisMonthCents: 0, rule: hardware });
  assert.equal(r.decision, "NEEDS_APPROVAL");
});

test("exactly at the threshold does not need approval", () => {
  const r = evaluatePolicy({ amountCents: 30000, category: "hardware", team, committedThisMonthCents: 0, rule: hardware });
  assert.equal(r.decision, "AUTO_APPROVE");
});

test("refuses blocked categories", () => {
  const r = evaluatePolicy({ amountCents: 10000, category: "gift_cards", team, committedThisMonthCents: 0, rule: { label: "Gift cards", max_item_cents: null, blocked: 1 } });
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reasons.join(" "), /blocked/);
});

test("refuses items over the category cap", () => {
  const r = evaluatePolicy({ amountCents: 180500, category: "furniture", team: { ...team, monthly_budget_cents: 900000 }, committedThisMonthCents: 0, rule: { label: "Furniture", max_item_cents: 70000, blocked: 0 } });
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reasons.join(" "), /per-item cap/);
});

test("refuses when the team budget would be exceeded, even below the threshold", () => {
  const r = evaluatePolicy({ amountCents: 20000, category: "hardware", team, committedThisMonthCents: 190000, rule: hardware });
  assert.equal(r.decision, "REFUSE");
  assert.match(r.reasons.join(" "), /over budget/);
});

test("refuses unknown categories and invalid prices", () => {
  assert.equal(evaluatePolicy({ amountCents: 1000, category: "yachts", team, committedThisMonthCents: 0, rule: undefined }).decision, "REFUSE");
  assert.equal(evaluatePolicy({ amountCents: 0, category: "hardware", team, committedThisMonthCents: 0, rule: hardware }).decision, "REFUSE");
  assert.equal(evaluatePolicy({ amountCents: 12.5, category: "hardware", team, committedThisMonthCents: 0, rule: hardware }).decision, "REFUSE");
});
