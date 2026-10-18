"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { LogoMark } from "./Logo";

type PolicyResult = { decision: string; reasons: string[]; remainingAfterCents: number };
type Purchase = {
  id: string; title: string; merchant: string; amount_cents: number; status: string; reason: string;
  paypal_order_id: string | null; paypal_capture_id: string | null;
};
type AgentEvent =
  | { type: "search"; query: string; results: { id: string; title: string; merchant: string; price: string; url: string; imageUrl: string | null; source: string }[] }
  | { type: "policy"; resultId: string; title: string; price: string; policy: PolicyResult }
  | { type: "purchase"; purchase: Purchase }
  | { type: "error"; message: string };
type Msg = { role: "user" | "agent"; text: string; events?: AgentEvent[] };

const SUGGESTIONS = [
  "I need a 27-inch 4K monitor for design work, under $600",
  "Get me an ergonomic office chair",
  "Buy a $100 Amazon gift card for a client",
];

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className="whitespace-pre-wrap leading-relaxed">
      {parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}
    </p>
  );
}

// Store image servers often refuse hotlinked requests that carry a Referer; if an image still fails, show the placeholder.
function ProductThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-slate-100 text-lg">🛒</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-12 w-12 shrink-0 rounded-md bg-slate-100 object-cover" />
  );
}

function EventCard({ e }: { e: AgentEvent }) {
  if (e.type === "search") {
    return (
      <div className="card p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Searched “{e.query}” · {e.results.length} results{e.results[0]?.source === "sample" ? " · sample catalog" : " · via Channel3"}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {e.results.slice(0, 4).map((r) => (
            <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="flex gap-3 rounded-lg border border-line p-2 hover:bg-slate-50">
              <ProductThumb src={r.imageUrl} />
              <span className="min-w-0 text-sm">
                <span className="line-clamp-2 font-medium">{r.title}</span>
                <span className="text-muted">{r.merchant} · <strong className="text-ink">{r.price}</strong></span>
              </span>
            </a>
          ))}
        </div>
      </div>
    );
  }
  if (e.type === "policy") {
    return (
      <div className="card p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Policy check</span>
          <StatusBadge status={e.policy.decision} />
        </div>
        <p className="mt-1.5 font-medium">{e.title} · {e.price}</p>
        <ul className="mt-1 list-disc pl-5 text-muted">{e.policy.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      </div>
    );
  }
  if (e.type === "purchase") {
    const p = e.purchase;
    const paid = p.status === "PAID";
    return (
      <div className={`rounded-2xl border-2 p-4 text-sm ${paid ? "border-emerald-300 bg-emerald-50" : p.status === "PENDING_APPROVAL" ? "border-amber-300 bg-amber-50" : "border-rose-200 bg-rose-50"}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-bold">{paid ? "Paid with PayPal" : p.status === "PENDING_APPROVAL" ? "Sent for approval" : "Not purchased"}</span>
          <StatusBadge status={p.status} />
        </div>
        <p className="mt-1 font-medium">{p.title} · {usd(p.amount_cents)} · {p.merchant}</p>
        <p className="mt-1 text-slate-600">{p.reason}</p>
        {p.paypal_order_id ? (
          <p className="mt-2 font-mono text-xs text-slate-600">PayPal order {p.paypal_order_id}{p.paypal_capture_id ? ` · capture ${p.paypal_capture_id}` : ""}</p>
        ) : null}
      </div>
    );
  }
  return <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{e.message}</div>;
}

export function AgentChat({ firstName }: { firstName: string }) {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    setConversationId(crypto.randomUUID());
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(text: string) {
    if (!text.trim() || busy || !conversationId) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });
      const data = await res.json();
      setMessages((m) => [...m, res.ok ? { role: "agent", text: data.text, events: data.events } : { role: "agent", text: "", events: [{ type: "error", message: data.error }] }]);
      // A purchase changes the team's budget; re-render the server-side sidebar.
      if (res.ok && (data.events as AgentEvent[]).some((e) => e.type === "purchase")) router.refresh();
    } catch (err) {
      setMessages((m) => [...m, { role: "agent", text: "", events: [{ type: "error", message: String(err) }] }]);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([]);
    setConversationId(crypto.randomUUID());
  }

  return (
    <section className="card flex min-h-[70vh] flex-col">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="flex items-center gap-2">
          <LogoMark size={26} />
          <span className="font-semibold">Your buying agent</span>
        </div>
        <button className="btn btn-ghost !py-1.5 text-sm" onClick={reset} disabled={busy}>New request</button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-xl font-bold">Hi {firstName}, what do you need?</p>
            <p className="mt-1 text-muted">I&apos;ll find the best option, check it against company rules, and pay with PayPal once you confirm.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="rounded-full border border-line bg-white px-3 py-1.5 text-sm hover:border-indigo-300 hover:bg-indigo-50" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-white">{m.text}</div>
            </div>
          ) : (
            <div key={i} className="space-y-3">
              {m.events?.map((e, j) => <EventCard key={j} e={e} />)}
              {m.text ? (
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2.5"><RichText text={m.text} /></div>
              ) : null}
            </div>
          ),
        )}
        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" /> Searching, comparing and checking the rules…
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask for anything you need for work…" disabled={busy} />
        <button className="btn btn-primary" disabled={busy || !input.trim()}>Send</button>
      </form>
    </section>
  );
}
