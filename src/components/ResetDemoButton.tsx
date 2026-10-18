"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetDemoButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  async function reset() {
    if (!confirm("Reset the demo? Budgets, rules and the ledger go back to their starting state. PayPal stays connected.")) return;
    setState("busy");
    const res = await fetch("/api/demo/reset", { method: "POST" }).catch(() => null);
    setState(res?.ok ? "done" : "error");
    router.refresh();
  }
  return (
    <button className={`btn btn-ghost text-sm ${className}`} onClick={reset} disabled={state === "busy"}>
      {state === "busy" ? "Resetting…" : state === "done" ? "Demo reset ✓" : state === "error" ? "Reset failed, try again" : "Reset demo"}
    </button>
  );
}
