"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalButtons({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  async function act(action: "approve" | "decline") {
    setBusy(action);
    setError("");
    const res = await fetch("/api/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ purchaseId, action }) });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Something went wrong.");
    else if (data.purchase?.status === "FAILED") setError(data.purchase.reason);
    setBusy(null);
    router.refresh();
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button className="btn btn-danger" disabled={busy !== null} onClick={() => act("decline")}>{busy === "decline" ? "…" : "Decline"}</button>
        <button className="btn btn-primary" disabled={busy !== null} onClick={() => act("approve")}>{busy === "approve" ? "Paying…" : "Approve & pay"}</button>
      </div>
      {error ? <p className="max-w-xs text-right text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
