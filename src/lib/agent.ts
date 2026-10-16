import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { GoogleGenAI, type Content, type Part } from "@google/genai";
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

const MAX_TOOL_ROUNDS = 8;

// ---------- which AI provider ----------

export type Provider = "gemini" | "claude";

/** AI_PROVIDER picks explicitly; otherwise Gemini if its key is set, else Claude. */
export function aiProvider(): Provider {
  const p = process.env.AI_PROVIDER?.toLowerCase();
  if (p === "gemini" || p === "claude") return p;
  return process.env.GEMINI_API_KEY ? "gemini" : "claude";
}

export function aiProviderLabel(): string {
  return aiProvider() === "gemini" ? `Gemini (${geminiModel()})` : `Claude (${CLAUDE_MODEL})`;
}

export function aiConfigError(): string | null {
  if (aiProvider() === "gemini") return process.env.GEMINI_API_KEY ? null : "GEMINI_API_KEY is not set.";
  return process.env.ANTHROPIC_API_KEY ? null : "ANTHROPIC_API_KEY is not set.";
}

const CLAUDE_MODEL = "claude-opus-5-5";
const geminiModel = () => process.env.GEMINI_MODEL || "gemini-2.5-flash";

let anthropic: Anthropic | null = null;
function claudeClient() {
  // Keys not scoped to a workspace must name one on every request.
  anthropic ??= new Anthropic(
    process.env.ANTHROPIC_WORKSPACE_ID
      ? { defaultHeaders: { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } }
      : {},
  );
  return anthropic;
}

let gemini: GoogleGenAI | null = null;
function geminiClient() {
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return gemini;
}

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

// ---------- tools (shared by both providers) ----------

function categoryEnum(): string[] {
  return getCategoryRules().map((r) => r.category);
}

interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

function toolSpecs(): ToolSpec[] {
  return [
    {
      name: "search_products",
      description:
        "Search real retailers for products. Returns up to 8 results, each with a result_id. Always search before recommending; never invent products or prices. Choose the category that honestly describes the item, because spending caps are set per category.",
      schema: {
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
      schema: {
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
      schema: {
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

// ---------- tool execution (shared) ----------

interface ToolOutcome {
  content: Record<string, unknown>;
  isError: boolean;
}

async function runTool(
  name: string,
  rawInput: unknown,
  member: Member,
  conversationId: string,
  events: AgentEvent[],
): Promise<ToolOutcome> {
  const ok = (content: Record<string, unknown>): ToolOutcome => ({ content, isError: false });
  const fail = (error: string): ToolOutcome => ({ content: { error }, isError: true });

  try {
    if (name === "search_products") {
      const input = SearchInput.parse(rawInput);
      if (!categoryEnum().includes(input.category)) return fail("Unknown category.");
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
      if (results.length === 0) return ok({ results: [], note: "No matches. Try a broader query." });
      return ok({
        results: results.map((r) => ({
          result_id: r.id,
          title: r.title,
          store: r.merchant,
          price: usd(r.priceCents),
          in_stock: r.inStock,
        })),
      });
    }

    if (name === "check_policy") {
      const input = ResultInput.parse(rawInput);
      const checked = policyForResult(member, input.result_id);
      if ("error" in checked) return fail(checked.error ?? "Search result not found.");
      events.push({
        type: "policy",
        resultId: input.result_id,
        title: checked.result.title,
        price: usd(checked.result.price_cents),
        policy: checked.policy,
      });
      return ok({
        decision: checked.policy.decision,
        reasons: checked.policy.reasons,
        team_budget_remaining_after: usd(checked.policy.remainingAfterCents),
      });
    }

    if (name === "place_order") {
      const input = OrderInput.parse(rawInput);
      const out = await placeOrder(member, input.result_id, input.justification);
      if ("error" in out) return fail(out.error ?? "Order failed.");
      events.push({ type: "purchase", purchase: out.purchase });
      return ok({
        status: out.purchase.status,
        reason: out.purchase.reason,
        paypal_order_id: out.purchase.paypal_order_id,
        amount: usd(out.purchase.amount_cents),
      });
    }

    return fail(`Unknown tool ${name}`);
  } catch (err) {
    const message = err instanceof z.ZodError ? "Invalid tool input." : err instanceof Error ? err.message : String(err);
    events.push({ type: "error", message });
    return fail(message);
  }
}

// ---------- conversation storage ----------

type Stored = { provider: "claude"; messages: BetaMessageParam[] } | { provider: "gemini"; messages: Content[] };

function loadConversation(member: Member, conversationId: string, provider: Provider): { stored: Stored; before: string } {
  const existing = getConversation(conversationId);
  if (existing && existing.member_id !== member.id) throw new Error("This conversation belongs to someone else.");
  const before = existing?.messages_json ?? "";
  const parsed: unknown = before ? JSON.parse(before) : null;
  // Older rows stored a bare Claude message array.
  const stored: Stored | null = Array.isArray(parsed) ? { provider: "claude", messages: parsed } : (parsed as Stored | null);
  // A conversation can't continue on a different provider; start it over.
  if (!stored || stored.provider !== provider) {
    return { stored: provider === "claude" ? { provider, messages: [] } : { provider, messages: [] }, before };
  }
  return { stored, before };
}

// ---------- the agent loop ----------

export async function runAgentTurn(member: Member, conversationId: string, userText: string) {
  const provider = aiProvider();
  const { stored, before } = loadConversation(member, conversationId, provider);
  const events: AgentEvent[] = [];
  const result =
    stored.provider === "claude"
      ? await claudeTurn(member, conversationId, stored.messages, userText, events)
      : await geminiTurn(member, conversationId, stored.messages, userText, events);

  if (result.refused) {
    // Leave the saved history as it was before this turn.
    if (before) saveConversation(conversationId, member.id, before);
  } else {
    saveConversation(conversationId, member.id, JSON.stringify(stored));
  }
  return { text: result.text, events };
}

// ----- Claude (Anthropic API) -----

async function claudeTurn(
  member: Member,
  conversationId: string,
  messages: BetaMessageParam[],
  userText: string,
  events: AgentEvent[],
): Promise<{ text: string; refused: boolean }> {
  const prior = messages[messages.length - 1];
  if (prior?.role === "user" && Array.isArray(prior.content)) {
    // The last turn ended on tool results (step limit); add the new text to that same user turn.
    prior.content.push({ type: "text", text: userText });
  } else {
    messages.push({ role: "user", content: userText });
  }

  const tools: BetaTool[] = toolSpecs().map((t) => ({
    name: t.name,
    description: t.description,
    strict: true,
    input_schema: t.schema as BetaTool["input_schema"],
  }));
  let text = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await claudeClient().beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      system: systemPrompt(member),
      tools,
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

    // A refusal can cut a tool call off mid-input; the caller drops this whole turn.
    if (response.stop_reason === "refusal") return { text: "Sorry, I can't help with that request.", refused: true };
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

    const results: BetaToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (t) => {
        const out = await runTool(t.name, t.input, member, conversationId, events);
        return { type: "tool_result" as const, tool_use_id: t.id, content: JSON.stringify(out.content), is_error: out.isError };
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { text, refused: false };
}

// ----- Gemini (Google Gen AI SDK) -----

async function geminiTurn(
  member: Member,
  conversationId: string,
  contents: Content[],
  userText: string,
  events: AgentEvent[],
): Promise<{ text: string; refused: boolean }> {
  contents.push({ role: "user", parts: [{ text: userText }] });
  const functionDeclarations = toolSpecs().map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.schema,
  }));
  let text = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const response = await geminiClient().models.generateContent({
      model: geminiModel(),
      contents,
      config: {
        systemInstruction: systemPrompt(member),
        tools: [{ functionDeclarations }],
        // We run the tools ourselves so every call goes through the rules engine.
        automaticFunctionCalling: { disable: true },
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content) {
      const blocked = response.promptFeedback?.blockReason ?? candidate?.finishReason;
      return { text: blocked ? "Sorry, I can't help with that request." : "I didn't get a response. Please try again.", refused: true };
    }
    // Keep the model's content unchanged (including thought signatures) for the next request.
    contents.push(candidate.content);
    text = (candidate.content.parts ?? [])
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) break;
    if (round === MAX_TOOL_ROUNDS) {
      contents.push({
        role: "user",
        parts: calls.map((c) => ({ functionResponse: { id: c.id, name: c.name, response: { error: "Step limit reached; not run." } } })),
      });
      text = text || "I took too many steps on that one. Could you rephrase what you need?";
      break;
    }

    const parts: Part[] = await Promise.all(
      calls.map(async (c) => {
        const out = await runTool(c.name ?? "", c.args ?? {}, member, conversationId, events);
        return { functionResponse: { id: c.id, name: c.name, response: out.isError ? out.content : { output: out.content } } };
      }),
    );
    contents.push({ role: "user", parts });
  }
  return { text, refused: false };
}
