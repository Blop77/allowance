"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface TeamRow { id: string; name: string; monthly_budget_cents: number; approval_threshold_cents: number; committed: number }
interface RuleRow { category: string; label: string; max_item_cents: number | null; blocked: number }

const toDollars = (c: number | null) => (c === null ? "" : String(c / 100));
const toCents = (d: string) => (d.trim() === "" ? null : Math.round(Number(d) * 100));
const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function RulesEditor({ teams, rules }: { teams: TeamRow[]; rules: RuleRow[] }) {
  const router = useRouter();
  const [t, setT] = useState(teams.map((x) => ({ ...x, budget: toDollars(x.monthly_budget_cents), threshold: toDollars(x.approval_threshold_cents) })));
  const [r, setR] = useState(rules.map((x) => ({ ...x, cap: toDollars(x.max_item_cents), isBlocked: Boolean(x.blocked) })));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function save() {
    setState("saving");
    const res = await fetch("/api/admin/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teams: t.map((x) => ({ id: x.id, monthly_budget_cents: toCents(x.budget) ?? 0, approval_threshold_cents: toCents(x.threshold) ?? 0 })),
        rules: r.map((x) => ({ category: x.category, max_item_cents: toCents(x.cap), blocked: x.isBlocked })),
      }),
    });
    setState(res.ok ? "saved" : "error");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card p-5">
        <h2 className="font-semibold">Team budgets</h2>
        <p className="text-sm text-muted">Monthly budget and the amount above which a manager must approve.</p>
        <div className="mt-4 space-y-4">
          {t.map((x, i) => {
            const pct = Math.min(100, Math.round((x.committed / Math.max(1, x.monthly_budget_cents)) * 100));
            return (
              <div key={x.id} className="rounded-xl border border-line p-3">
                <div className="flex items-baseline justify-between">
                  <p className="font-semibold">{x.name}</p>
                  <p className="text-xs text-muted">{usd(x.committed)} committed this month</p>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="brand-gradient h-full" style={{ width: `${pct}%` }} /></div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <label>Monthly budget ($)
                    <input className="input mt-1" inputMode="decimal" value={x.budget} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, budget: e.target.value } : y)))} />
                  </label>
                  <label>Approval over ($)
                    <input className="input mt-1" inputMode="decimal" value={x.threshold} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, threshold: e.target.value } : y)))} />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Category rules</h2>
        <p className="text-sm text-muted">Per-item caps (leave empty for no cap) and blocked categories.</p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="pb-2 font-semibold">Category</th>
              <th className="pb-2 font-semibold">Max per item ($)</th>
              <th className="pb-2 text-right font-semibold">Blocked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {r.map((x, i) => (
              <tr key={x.category}>
                <td className="py-2 pr-2 font-medium">{x.label}</td>
                <td className="py-2 pr-2">
                  <input className="input !py-1.5" inputMode="decimal" disabled={x.isBlocked} value={x.cap} placeholder="No cap"
                    onChange={(e) => setR(r.map((y, j) => (j === i ? { ...y, cap: e.target.value } : y)))} />
                </td>
                <td className="py-2 text-right">
                  <input type="checkbox" className="h-4 w-4 accent-rose-600" checked={x.isBlocked}
                    onChange={(e) => setR(r.map((y, j) => (j === i ? { ...y, isBlocked: e.target.checked } : y)))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="flex items-center gap-3 lg:col-span-2">
        <button className="btn btn-primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save rules"}</button>
        {state === "saved" ? <span className="text-sm text-emerald-700">Saved. Agents use the new rules from their next request.</span> : null}
        {state === "error" ? <span className="text-sm text-rose-600">Could not save. Check the values.</span> : null}
      </div>
    </div>
  );
}
