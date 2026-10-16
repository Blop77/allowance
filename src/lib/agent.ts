import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import {
  getCategoryRules,
  getConversation,
  getTeam,
  insertSearchResult,
  newId,
  now,
  saveConversation,
  committedThisMonthCents,
  type Member,
  type Purchase,
} from "./db";
import { searchProducts } from "./products";
import { placeOrder, policyForResult } from "./purchasing";
import { usd, type PolicyResult } from "./policy";

const MODEL = "claude-opus-5-5";
const MAX_TOOL_ROUNDS = 8;

// Keys not scoped to a workspace must name one on every request.
const client = new Anthropic(
  process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
    : {},
);

// ---------- what the UI shows for each tool call ----------

export type AgentEvent =
  | {
      type: "search";
      query: string;
      results: { id: string; title: string; merchant: string; price: string; url: string; imageUrl: string | null; source: string }[];
    }
  | { type: "policy"; resultId: string; title: string; price: string; policy: PolicyResult }
  | { type: "purchase"; purchase: Purchase }
  | { type: "error"; message: string };

// ---------- tools ----------

function categoryEnum(): string[] {
  return getCategoryRules().map((r) => r.category);
}

function tools(): BetaTool[] {
  return [
    {
      name: "search_products",
      description:
        "Search real retailers for products. Returns up to 8 results, each with a result_id. Always search before recommending; never invent products or prices. Choose the category that honestly describes the item, because spending caps are set per category.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Shopping query, e.g. '27 inch 4K USB-C monitor'." },
          category: { type: "string", enum: categoryEnum(), description: "Spending category of the item." },
          max_price_usd: { type: "number", description: "Optional price ceiling in US dollars." },
        },
        required: ["query", "category"],
      },
    },
    {
      name: "check_policy",
      description:
        "Check a search result against the company's spending rules without buying it. Returns AUTO_APPROVE, NEEDS_APPROVAL or REFUSE with reasons and the team's remaining budget.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: { result_id: { type: "string" } },
        required: ["result_id"],
      },
    },
    {
      name: "place_order",
      description:
        "Buy a search result with the company's PayPal account. The rules are enforced by the system: it pays immediately, sends it to the manager for approval, or refuses. Only call this after the teammate has clearly confirmed they want this specific item.",
      strict: true,
      input_schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          result_id: { type: "string" },
          justification: { type: "string", description: "One sentence on why the teammate needs it, for the ledger and approver." },
        },
        required: ["result_id", "justification"],
      },
    },
  ];
}

const SearchInput = z.object({
  query: z.string().min(1),
  category: z.string(),
  max_price_usd: z.number().positive().optional(),
});
const ResultInput = z.object({ result_id: z.string().min(1) });
const OrderInput = z.object({ result_id: z.string().min(1), justification: z.string() });

function systemPrompt(member: Member): string {
  const team = getTeam(member.team_id)!;
  const remaining = team.monthly_budget_cents - committedThisMonthCents(team.id);
  const rules = getCategoryRules()
    .map((r) => `- ${r.category} (${r.label}): ${r.blocked ? "BLOCKED" : r.max_item_cents === null ? "no per-item cap" : `max ${usd(r.max_item_cents)} per item`}`)
    .join("\n");
  return `You are Allowance, a buying agent for ${member.name} (${member.title}) on the ${team.name} team. You find the best product for what they ask for and buy it with the company's PayPal account.

How you work:
1. Search with search_products. Compare price, store reputation, and fit; recommend one option (plus at most one alternative) in 2-4 short sentences, citing the price.
2. Use check_policy on your recommendation and tell the teammate plainly whether it will be paid instantly, needs ${team.name}'s manager's approval, or isn't allowed (and why).
3. Only call place_order after the teammate explicitly confirms (e.g. "yes", "buy it", "order it"). Never buy without confirmation.
4. If something isn't allowed, say which rule blocks it and suggest an in-policy alternative if one exists. Never try to get around a rule, for example by choosing a different category than the item really belongs to or splitting an order.

Company rules (enforced by the system, not by you):
- ${team.name} monthly budget: ${usd(team.monthly_budget_cents)}; about ${usd(remaining)} left this month.
- Purchases over ${usd(team.approval_threshold_cents)} need manager approval.
- Category caps:
${rules}

Keep replies short and friendly. The app shows search results, policy checks and receipts as cards, so don't repeat every detail in text. Prices are in USD. This is a PayPal sandbox demo: payments use test money.`;
}

// ---------- tool execution ----------

async function runTool(
  tool: BetaToolUseBlock,
  member: Member,
  conversationId: string,
  events: AgentEvent[],
): Promise<BetaToolResultBlockParam> {
  const reply = (content: unknown, isError = false): BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: tool.id,
    content: JSON.stringify(content),
    is_error: isError,
  });

  try {
    if (tool.name === "search_products") {
      const input = SearchInput.parse(tool.input);
      if (!categoryEnum().includes(input.category)) return reply({ error: "Unknown category." }, true);
      const hits = await searchProducts(input.query, input.max_price_usd);
      const results = hits.map((h) => {
        const id = newId("res");
        insertSearchResult({
          id,
          conversation_id: conversationId,
          title: h.title,
          merchant: h.merchant,
          url: h.url,
          image_url: h.imageUrl,
          price_cents: h.priceCents,
          currency: h.currency,
          category: input.category,
          source: h.source,
          created_at: now(),
        });
        return { id, ...h };
      });
      events.push({
        type: "search",
        query: input.query,
        results: results.map((r) => ({
          id: r.id,
          title: r.title,
          merchant: r.merchant,
          price: usd(r.priceCents),
          url: r.url,
          imageUrl: r.imageUrl,
          source: r.source,
        })),
      });
      if (results.length === 0) return reply({ results: [], note: "No matches. Try a broader query." });
      return reply({
        results: results.map((r) => ({
          result_id: r.id,
          title: r.title,
          store: r.merchant,
          price: usd(r.priceCents),
          in_stock: r.inStock,
        })),
      });
    }

    if (tool.name === "check_policy") {
      const input = ResultInput.parse(tool.input);
      const checked = policyForResult(member, input.result_id);
      if ("error" in checked) return reply({ error: checked.error }, true);
      events.push({
        type: "policy",
        resultId: input.result_id,
        title: checked.result.title,
        price: usd(checked.result.price_cents),
        policy: checked.policy,
      });
      return reply({
        decision: checked.policy.decision,
        reasons: checked.policy.reasons,
        team_budget_remaining_after: usd(checked.policy.remainingAfterCents),
      });
    }

    if (tool.name === "place_order") {
      const input = OrderInput.parse(tool.input);
      const out = await placeOrder(member, input.result_id, input.justification);
      if ("error" in out) return reply({ error: out.error }, true);
      events.push({ type: "purchase", purchase: out.purchase });
      return reply({
        status: out.purchase.status,
        reason: out.purchase.reason,
        paypal_order_id: out.purchase.paypal_order_id,
        amount: usd(out.purchase.amount_cents),
      });
    }

    return reply({ error: `Unknown tool ${tool.name}` }, true);
  } catch (err) {
    const message = err instanceof z.ZodError ? "Invalid tool input." : err instanceof Error ? err.message : String(err);
    events.push({ type: "error", message });
    return reply({ error: message }, true);
  }
}

// ---------- the agent loop ----------

export async function runAgentTurn(member: Member, conversationId: string, userText: string) {
  const existing = getConversation(conversationId);
  if (existing && existing.member_id !== member.id) throw new Error("This conversation belongs to someone else.");
  const before = existing?.messages_json ?? "[]";
  const messages: BetaMessageParam[] = JSON.parse(before);
  const prior = messages[messages.length - 1];
  if (prior?.role === "user" && Array.isArray(prior.content)) {
    // The last turn ended on tool results (step limit); add the new text to that same user turn.
    prior.content.push({ type: "text", text: userText });
  } else {
    messages.push({ role: "user", content: userText });
  }

  const events: AgentEvent[] = [];
  let text = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(member),
      tools: tools(),
      messages,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    // Append the full content (including thinking blocks) unchanged so the next turn replays it exactly.
    messages.push({ role: "assistant", content: response.content });
    text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();

    if (response.stop_reason === "refusal") {
      // A refusal can cut a tool call off mid-input; drop this whole turn so the saved history stays valid.
      saveConversation(conversationId, member.id, before);
      return { text: "Sorry, I can't help with that request.", events };
    }
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;
    if (round === MAX_TOOL_ROUNDS) {
      messages.push({
        role: "user",
        content: toolUses.map((t) => ({
          type: "tool_result" as const,
          tool_use_id: t.id,
          content: "Step limit reached; not run.",
          is_error: true,
        })),
      });
      text = text || "I took too many steps on that one. Could you rephrase what you need?";
      break;
    }

    const results = await Promise.all(toolUses.map((t) => runTool(t, member, conversationId, events)));
    messages.push({ role: "user", content: results });
  }

  saveConversation(conversationId, member.id, JSON.stringify(messages));
  return { text, events };
}
