import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { currentMember } from "@/lib/session";

const Body = z.object({
  teams: z.array(
    z.object({
      id: z.string(),
      monthly_budget_cents: z.number().int().min(0),
      approval_threshold_cents: z.number().int().min(0),
    }),
  ),
  rules: z.array(
    z.object({
      category: z.string(),
      max_item_cents: z.number().int().min(0).nullable(),
      blocked: z.boolean(),
    }),
  ),
});

export async function PUT(req: Request) {
  const member = await currentMember();
  if (member?.role !== "ADMIN") return NextResponse.json({ error: "Only a finance admin can change rules." }, { status: 403 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid rules." }, { status: 400 });
  const conn = db();
  const t = conn.prepare("UPDATE teams SET monthly_budget_cents = ?, approval_threshold_cents = ? WHERE id = ?");
  for (const team of parsed.data.teams) t.run(team.monthly_budget_cents, team.approval_threshold_cents, team.id);
  const r = conn.prepare("UPDATE category_rules SET max_item_cents = ?, blocked = ? WHERE category = ?");
  for (const rule of parsed.data.rules) r.run(rule.max_item_cents, rule.blocked ? 1 : 0, rule.category);
  return NextResponse.json({ ok: true });
}
