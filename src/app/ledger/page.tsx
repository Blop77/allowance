import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { committedThisMonthCents, getMembers, getPurchases, getTeams } from "@/lib/db";
import { usd } from "@/lib/policy";
import { LedgerGrid } from "@/components/LedgerGrid";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const member = await currentMember();
  if (!member) redirect("/");
  const allTeams = getTeams();
  const visibleTeams = member.role === "ADMIN" ? allTeams : allTeams.filter((t) => t.id === member.team_id);
  const teamName = Object.fromEntries(allTeams.map((t) => [t.id, t.name]));
  const people = Object.fromEntries(getMembers().map((m) => [m.id, m.name]));
  const rows = getPurchases(member.role === "ADMIN" ? undefined : { teamId: member.team_id }).map((p) => ({
    id: p.id,
    created_at: p.created_at,
    team: teamName[p.team_id],
    requester: people[p.member_id],
    title: p.title,
    merchant: p.merchant,
    category: p.category,
    amount: p.amount_cents / 100,
    status: p.status,
    paypal_order_id: p.paypal_order_id ?? "",
    paypal_status: p.paypal_status ?? "",
    decided_by: p.decided_by ?? "",
    reason: p.reason,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Spend ledger</h1>
        <p className="text-muted">Every request the agents made: what was paid through PayPal, what waited for approval, and what the rules refused.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {visibleTeams.map((t) => {
          const committed = committedThisMonthCents(t.id);
          const pct = Math.min(100, Math.round((committed / Math.max(1, t.monthly_budget_cents)) * 100));
          return (
            <div key={t.id} className="card p-4">
              <p className="text-sm font-semibold text-muted">{t.name}</p>
              <p className="mt-1 text-xl font-bold">{usd(committed)} <span className="text-sm font-medium text-muted">/ {usd(t.monthly_budget_cents)}</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="brand-gradient h-full" style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>
      <LedgerGrid rows={rows} />
    </div>
  );
}
