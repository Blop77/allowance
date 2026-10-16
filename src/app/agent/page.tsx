import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { committedThisMonthCents, getTeam } from "@/lib/db";
import { productSource } from "@/lib/products";
import { vaultId } from "@/lib/purchasing";
import { usd } from "@/lib/policy";
import { AgentChat } from "@/components/AgentChat";

export const dynamic = "force-dynamic";

export default async function AgentPage() {
  const member = await currentMember();
  if (!member) redirect("/");
  const team = getTeam(member.team_id)!;
  const committed = committedThisMonthCents(team.id);
  const pct = Math.min(100, Math.round((committed / team.monthly_budget_cents) * 100));
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <AgentChat firstName={member.name.split(" ")[0]} />
      <aside className="space-y-4">
        <div className="card p-4">
          <p className="text-sm font-semibold text-muted">{team.name} · this month</p>
          <p className="mt-1 text-2xl font-bold">{usd(committed)} <span className="text-base font-medium text-muted">of {usd(team.monthly_budget_cents)}</span></p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="brand-gradient h-full rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-sm text-muted">Over {usd(team.approval_threshold_cents)} goes to your manager for approval.</p>
        </div>
        <div className="card space-y-2 p-4 text-sm">
          <p className="font-semibold">Connected services</p>
          <p className="flex justify-between"><span className="text-muted">AI agent</span><span>Claude</span></p>
          <p className="flex justify-between"><span className="text-muted">Product search</span><span>{productSource() === "channel3" ? "Channel3" : "Sample catalog"}</span></p>
          <p className="flex justify-between"><span className="text-muted">Payments</span><span>{vaultId() ? "PayPal (connected)" : "PayPal (not connected)"}</span></p>
        </div>
      </aside>
    </div>
  );
}
