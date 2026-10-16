import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { committedThisMonthCents, getMembers, getPurchases, getTeam, getTeams } from "@/lib/db";
import { usd } from "@/lib/policy";
import { StatusBadge } from "@/components/StatusBadge";
import { ApprovalButtons } from "@/components/ApprovalButtons";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const member = await currentMember();
  if (!member) redirect("/");
  if (member.role === "TEAMMATE") redirect("/agent");
  const scope = member.role === "ADMIN" ? undefined : member.team_id;
  const people = Object.fromEntries(getMembers().map((m) => [m.id, m]));
  const teams = Object.fromEntries(getTeams().map((t) => [t.id, t]));
  const pending = getPurchases({ teamId: scope, status: "PENDING_APPROVAL" });
  const recent = getPurchases({ teamId: scope }).filter((p) => p.status !== "PENDING_APPROVAL").slice(0, 8);
  const team = scope ? getTeam(scope) : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-muted">
          {team
            ? `${team.name} has spent or committed ${usd(committedThisMonthCents(team.id))} of ${usd(team.monthly_budget_cents)} this month.`
            : "All teams."}{" "}
          Approving charges the company PayPal account immediately.
        </p>
      </div>

      {pending.length === 0 ? (
        <div className="card p-8 text-center text-muted">Nothing waiting for you. 🎉</div>
      ) : (
        <div className="space-y-3">
          {pending.map((p) => (
            <div key={p.id} className="card flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold">{usd(p.amount_cents)}</span>
                  <StatusBadge status={p.status} />
                  <span className="text-sm text-muted">{teams[p.team_id]?.name}</span>
                </div>
                <p className="mt-1 font-medium">{p.title}</p>
                <p className="text-sm text-muted">{p.merchant} · requested by {people[p.member_id]?.name}</p>
                {p.justification ? <p className="mt-1 text-sm">“{p.justification}”</p> : null}
                <p className="mt-1 text-sm text-amber-700">{p.reason}</p>
              </div>
              <ApprovalButtons purchaseId={p.id} />
            </div>
          ))}
        </div>
      )}

      <div>
        <h2 className="mb-2 font-semibold">Recent decisions</h2>
        <div className="card divide-y divide-line">
          {recent.length === 0 ? <p className="p-4 text-sm text-muted">No purchases yet.</p> : null}
          {recent.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <StatusBadge status={p.status} />
              <span className="font-medium">{p.title}</span>
              <span className="text-muted">{usd(p.amount_cents)} · {people[p.member_id]?.name}</span>
              <span className="ml-auto text-xs text-muted">{p.decided_by ? `by ${p.decided_by}` : ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
