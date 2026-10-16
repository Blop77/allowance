// The spending rules engine. Pure and deterministic on purpose: the AI agent
// can ask what the rules say, but only this code decides whether money moves.

export type Decision = "AUTO_APPROVE" | "NEEDS_APPROVAL" | "REFUSE";

export interface PolicyInput {
  amountCents: number;
  category: string;
  team: { name: string; monthly_budget_cents: number; approval_threshold_cents: number };
  committedThisMonthCents: number;
  rule: { label: string; max_item_cents: number | null; blocked: number } | undefined;
}

export interface PolicyResult {
  decision: Decision;
  reasons: string[];
  remainingBeforeCents: number;
  remainingAfterCents: number;
}

export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { amountCents, team, rule, committedThisMonthCents } = input;
  const remainingBeforeCents = team.monthly_budget_cents - committedThisMonthCents;
  const remainingAfterCents = remainingBeforeCents - amountCents;
  const refusals: string[] = [];

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    refusals.push("The price is missing or invalid.");
  }
  if (!rule) {
    refusals.push(`"${input.category}" is not a category the company allows.`);
  } else {
    if (rule.blocked) refusals.push(`"${rule.label}" is a blocked category under company policy.`);
    if (rule.max_item_cents !== null && amountCents > rule.max_item_cents) {
      refusals.push(`${usd(amountCents)} is over the ${usd(rule.max_item_cents)} per-item cap for ${rule.label}.`);
    }
  }
  if (remainingAfterCents < 0) {
    refusals.push(
      `${team.name} has ${usd(Math.max(remainingBeforeCents, 0))} left this month; this would go ${usd(-remainingAfterCents)} over budget.`,
    );
  }

  if (refusals.length > 0) {
    return { decision: "REFUSE", reasons: refusals, remainingBeforeCents, remainingAfterCents };
  }
  if (amountCents > team.approval_threshold_cents) {
    return {
      decision: "NEEDS_APPROVAL",
      reasons: [`${usd(amountCents)} is above ${team.name}'s ${usd(team.approval_threshold_cents)} approval threshold.`],
      remainingBeforeCents,
      remainingAfterCents,
    };
  }
  return {
    decision: "AUTO_APPROVE",
    reasons: [
      `Within the ${rule!.label} cap, under the approval threshold, and ${usd(remainingAfterCents)} of ${team.name}'s budget remains after.`,
    ],
    remainingBeforeCents,
    remainingAfterCents,
  };
}
