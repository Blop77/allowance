import "server-only";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type Role = "ADMIN" | "MANAGER" | "TEAMMATE";
export type PurchaseStatus =
  | "PAID"
  | "PENDING_APPROVAL"
  | "REFUSED"
  | "DECLINED"
  | "FAILED";

export interface Team {
  id: string;
  name: string;
  monthly_budget_cents: number;
  approval_threshold_cents: number;
}

export interface Member {
  id: string;
  name: string;
  title: string;
  role: Role;
  team_id: string;
}

export interface CategoryRule {
  category: string;
  label: string;
  max_item_cents: number | null;
  blocked: number;
}

export interface SearchResult {
  id: string;
  conversation_id: string;
  title: string;
  merchant: string;
  url: string;
  image_url: string | null;
  price_cents: number;
  currency: string;
  category: string;
  source: string;
  created_at: string;
}

export interface Purchase {
  id: string;
  member_id: string;
  team_id: string;
  search_result_id: string | null;
  title: string;
  merchant: string;
  url: string;
  image_url: string | null;
  category: string;
  amount_cents: number;
  currency: string;
  status: PurchaseStatus;
  reason: string;
  justification: string;
  paypal_order_id: string | null;
  paypal_capture_id: string | null;
  paypal_status: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_budget_cents INTEGER NOT NULL,
  approval_threshold_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams(id)
);
CREATE TABLE IF NOT EXISTS category_rules (
  category TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  max_item_cents INTEGER,
  blocked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS search_results (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  merchant TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  search_result_id TEXT,
  title TEXT NOT NULL,
  merchant TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  justification TEXT NOT NULL DEFAULT '',
  paypal_order_id TEXT,
  paypal_capture_id TEXT,
  paypal_status TEXT,
  decided_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  received_at TEXT NOT NULL
);
`;

const globalForDb = globalThis as unknown as { allowanceDb?: DatabaseSync };

export function db(): DatabaseSync {
  if (globalForDb.allowanceDb) return globalForDb.allowanceDb;
  const file = path.resolve(process.env.DATABASE_PATH ?? "./data/allowance.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  conn.exec(SCHEMA);
  seedIfEmpty(conn);
  restorePayPalFromEnv(conn);
  globalForDb.allowanceDb = conn;
  return conn;
}

// Hosts with a throwaway disk (e.g. Render's free tier) lose the database on restart. If the vault token from a
// previous connection is in the environment, reconnect with it so the admin doesn't have to approve PayPal again.
function restorePayPalFromEnv(conn: DatabaseSync) {
  const token = process.env.PAYPAL_PAYMENT_TOKEN_ID?.trim();
  if (!token) return;
  const existing = conn.prepare("SELECT value FROM settings WHERE key = 'paypal_payment_token_id'").get();
  if (existing) return;
  const ins = conn.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  ins.run("paypal_payment_token_id", token);
  ins.run("paypal_connected_at", new Date().toISOString());
  const email = process.env.PAYPAL_ACCOUNT_EMAIL?.trim();
  if (email) ins.run("paypal_account_email", email);
}

function seedIfEmpty(conn: DatabaseSync) {
  const row = conn.prepare("SELECT COUNT(*) AS n FROM teams").get() as { n: number };
  if (row.n > 0) return;

  const teams: Team[] = [
    { id: "design", name: "Design", monthly_budget_cents: 200000, approval_threshold_cents: 30000 },
    { id: "engineering", name: "Engineering", monthly_budget_cents: 500000, approval_threshold_cents: 50000 },
    { id: "operations", name: "Operations", monthly_budget_cents: 100000, approval_threshold_cents: 15000 },
  ];
  const members: Member[] = [
    { id: "priya", name: "Priya Shah", title: "Product Designer", role: "TEAMMATE", team_id: "design" },
    { id: "sam", name: "Sam Rivera", title: "Design Lead", role: "MANAGER", team_id: "design" },
    { id: "alex", name: "Alex Kim", title: "Software Engineer", role: "TEAMMATE", team_id: "engineering" },
    { id: "jordan", name: "Jordan Patel", title: "Engineering Manager", role: "MANAGER", team_id: "engineering" },
    { id: "morgan", name: "Morgan Lee", title: "Finance Admin", role: "ADMIN", team_id: "operations" },
  ];
  const rules: CategoryRule[] = [
    { category: "hardware", label: "Hardware & electronics", max_item_cents: 80000, blocked: 0 },
    { category: "software", label: "Software & subscriptions", max_item_cents: 20000, blocked: 0 },
    { category: "office_supplies", label: "Office supplies", max_item_cents: 15000, blocked: 0 },
    { category: "furniture", label: "Furniture", max_item_cents: 70000, blocked: 0 },
    { category: "books_learning", label: "Books & learning", max_item_cents: 10000, blocked: 0 },
    { category: "travel", label: "Travel", max_item_cents: null, blocked: 1 },
    { category: "gift_cards", label: "Gift cards", max_item_cents: null, blocked: 1 },
    { category: "other", label: "Other", max_item_cents: 25000, blocked: 0 },
  ];

  const insTeam = conn.prepare(
    "INSERT INTO teams (id, name, monthly_budget_cents, approval_threshold_cents) VALUES (?, ?, ?, ?)",
  );
  for (const t of teams) insTeam.run(t.id, t.name, t.monthly_budget_cents, t.approval_threshold_cents);

  const insMember = conn.prepare(
    "INSERT INTO members (id, name, title, role, team_id) VALUES (?, ?, ?, ?, ?)",
  );
  for (const m of members) insMember.run(m.id, m.name, m.title, m.role, m.team_id);

  const insRule = conn.prepare(
    "INSERT INTO category_rules (category, label, max_item_cents, blocked) VALUES (?, ?, ?, ?)",
  );
  for (const r of rules) insRule.run(r.category, r.label, r.max_item_cents, r.blocked);
}

type Param = string | number | null;

// node:sqlite returns null-prototype rows; copy them into plain objects so they can cross into React client components.
function rows<T>(sql: string, ...args: Param[]): T[] {
  return (db().prepare(sql).all(...args) as object[]).map((r) => ({ ...r }) as T);
}

function row<T>(sql: string, ...args: Param[]): T | undefined {
  const r = db().prepare(sql).get(...args) as object | undefined;
  return r ? ({ ...r } as T) : undefined;
}

export const now = () => new Date().toISOString();
export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

// ---------- queries ----------

export function getTeams(): Team[] {
  return rows<Team>("SELECT * FROM teams ORDER BY name");
}

export function getTeam(id: string): Team | undefined {
  return row<Team>("SELECT * FROM teams WHERE id = ?", id);
}

export function getMembers(): Member[] {
  return rows<Member>("SELECT * FROM members ORDER BY CASE role WHEN 'TEAMMATE' THEN 0 WHEN 'MANAGER' THEN 1 ELSE 2 END, name");
}

export function getMember(id: string): Member | undefined {
  return row<Member>("SELECT * FROM members WHERE id = ?", id);
}

export function getCategoryRules(): CategoryRule[] {
  return rows<CategoryRule>("SELECT * FROM category_rules ORDER BY label");
}

export function getCategoryRule(category: string): CategoryRule | undefined {
  return row<CategoryRule>("SELECT * FROM category_rules WHERE category = ?", category);
}

export function getSetting(key: string): string | undefined {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string) {
  db()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function deleteSetting(key: string) {
  db().prepare("DELETE FROM settings WHERE key = ?").run(key);
}

/** Spend that counts against a team's budget this calendar month (UTC): paid + awaiting approval. */
export function committedThisMonthCents(teamId: string, excludePurchaseId?: string): number {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM purchases
       WHERE team_id = ? AND status IN ('PAID', 'PENDING_APPROVAL') AND created_at >= ? AND id != ?`,
    )
    .get(teamId, start.toISOString(), excludePurchaseId ?? "") as { total: number };
  return row.total;
}

export function getPurchases(filter?: { teamId?: string; status?: PurchaseStatus }): Purchase[] {
  const where: string[] = [];
  const args: string[] = [];
  if (filter?.teamId) {
    where.push("team_id = ?");
    args.push(filter.teamId);
  }
  if (filter?.status) {
    where.push("status = ?");
    args.push(filter.status);
  }
  const sql = `SELECT * FROM purchases ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`;
  return rows<Purchase>(sql, ...args);
}

export function getPurchase(id: string): Purchase | undefined {
  return row<Purchase>("SELECT * FROM purchases WHERE id = ?", id);
}

export function insertPurchase(p: Purchase) {
  db()
    .prepare(
      `INSERT INTO purchases (id, member_id, team_id, search_result_id, title, merchant, url, image_url, category,
        amount_cents, currency, status, reason, justification, paypal_order_id, paypal_capture_id, paypal_status,
        decided_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.id, p.member_id, p.team_id, p.search_result_id, p.title, p.merchant, p.url, p.image_url, p.category,
      p.amount_cents, p.currency, p.status, p.reason, p.justification, p.paypal_order_id, p.paypal_capture_id,
      p.paypal_status, p.decided_by, p.created_at, p.updated_at,
    );
}

export function updatePurchase(id: string, fields: Partial<Omit<Purchase, "id">>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => fields[k] ?? null) as (string | number | null)[];
  db()
    .prepare(`UPDATE purchases SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, now(), id);
}

export function getSearchResult(id: string): SearchResult | undefined {
  return row<SearchResult>("SELECT * FROM search_results WHERE id = ?", id);
}

export function insertSearchResult(r: SearchResult) {
  db()
    .prepare(
      `INSERT INTO search_results (id, conversation_id, title, merchant, url, image_url, price_cents, currency,
        category, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(r.id, r.conversation_id, r.title, r.merchant, r.url, r.image_url, r.price_cents, r.currency, r.category,
      r.source, r.created_at);
}

export function getConversation(id: string): { id: string; member_id: string; messages_json: string } | undefined {
  return row<{ id: string; member_id: string; messages_json: string }>("SELECT * FROM conversations WHERE id = ?", id);
}

export function saveConversation(id: string, memberId: string, messagesJson: string) {
  const ts = now();
  db()
    .prepare(
      `INSERT INTO conversations (id, member_id, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at`,
    )
    .run(id, memberId, messagesJson, ts, ts);
}

export function recordWebhookEvent(id: string, eventType: string, resourceId: string | null): boolean {
  const res = db()
    .prepare("INSERT OR IGNORE INTO webhook_events (id, event_type, resource_id, received_at) VALUES (?, ?, ?, ?)")
    .run(id, eventType, resourceId, now());
  return Number(res.changes) > 0;
}
