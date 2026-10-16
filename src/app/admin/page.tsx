import { redirect } from "next/navigation";
import { currentMember } from "@/lib/session";
import { getCategoryRules, getSetting, getTeams, committedThisMonthCents } from "@/lib/db";
import { paypalConfigured } from "@/lib/paypal";
import { RulesEditor } from "@/components/RulesEditor";
import { PayPalConnect } from "@/components/PayPalConnect";

export const dynamic = "force-dynamic";

const NOTICES: Record<string, [string, string]> = {
  connected: ["bg-emerald-50 text-emerald-800", "Company PayPal account connected. Agents can now pay within your rules."],
  cancelled: ["bg-slate-100 text-slate-700", "PayPal connection cancelled."],
  not_configured: ["bg-rose-50 text-rose-700", "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set on the server."],
  forbidden: ["bg-rose-50 text-rose-700", "Only a finance admin can connect PayPal."],
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const member = await currentMember();
  if (!member) redirect("/");
  if (member.role !== "ADMIN") redirect("/approvals");
  const sp = await searchParams;
  const notice = sp.paypal === "error" ? (["bg-rose-50 text-rose-700", `PayPal error: ${sp.message ?? "unknown"}`] as [string, string]) : sp.paypal ? NOTICES[sp.paypal] : undefined;
  const teams = getTeams().map((t) => ({ ...t, committed: committedThisMonthCents(t.id) }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rules &amp; PayPal</h1>
        <p className="text-muted">Agents can recommend anything. Only purchases inside these rules are paid.</p>
      </div>
      {notice ? <div className={`rounded-xl px-4 py-3 text-sm font-medium ${notice[0]}`}>{notice[1]}</div> : null}
      <PayPalConnect
        configured={paypalConfigured()}
        connected={Boolean(getSetting("paypal_payment_token_id"))}
        tokenId={getSetting("paypal_payment_token_id") ?? null}
        tokenFromEnv={Boolean(process.env.PAYPAL_PAYMENT_TOKEN_ID)}
        email={getSetting("paypal_account_email") ?? null}
        connectedAt={getSetting("paypal_connected_at") ?? null}
      />
      <RulesEditor teams={teams} rules={getCategoryRules()} />
    </div>
  );
}
