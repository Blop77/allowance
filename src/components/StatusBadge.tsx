const STYLES: Record<string, string> = {
  PAID: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-700 ring-amber-200",
  REFUSED: "bg-rose-50 text-rose-700 ring-rose-200",
  DECLINED: "bg-slate-100 text-slate-700 ring-slate-200",
  FAILED: "bg-rose-50 text-rose-700 ring-rose-200",
  AUTO_APPROVE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  NEEDS_APPROVAL: "bg-amber-50 text-amber-700 ring-amber-200",
  REFUSE: "bg-rose-50 text-rose-700 ring-rose-200",
};
const LABELS: Record<string, string> = {
  PAID: "Paid",
  PENDING_APPROVAL: "Awaiting approval",
  REFUSED: "Refused by policy",
  DECLINED: "Declined",
  FAILED: "Payment failed",
  AUTO_APPROVE: "Pays instantly",
  NEEDS_APPROVAL: "Needs manager approval",
  REFUSE: "Not allowed",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${STYLES[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
      {LABELS[status] ?? status}
    </span>
  );
}
