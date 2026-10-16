"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface P { id: string; name: string; title: string; role: string; team: string }

const ROLE: Record<string, string> = { TEAMMATE: "Teammate", MANAGER: "Manager", ADMIN: "Finance admin" };

export function PersonaPicker({ members }: { members: P[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function pick(id: string) {
    setBusy(id);
    const res = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: id }) });
    const data = await res.json();
    router.push(data.home ?? "/");
    router.refresh();
  }
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      {members.map((m) => (
        <button key={m.id} onClick={() => pick(m.id)} disabled={busy !== null}
          className="flex items-center gap-3 rounded-xl border border-line p-3 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-bold text-indigo-700">
            {m.name.split(" ").map((x) => x[0]).join("")}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{m.name}</span>
            <span className="block truncate text-sm text-muted">{m.title} · {m.team}</span>
          </span>
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {busy === m.id ? "…" : ROLE[m.role]}
          </span>
        </button>
      ))}
    </div>
  );
}
