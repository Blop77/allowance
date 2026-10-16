"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PayPalConnect(props: {
  configured: boolean;
  connected: boolean;
  email: string | null;
  connectedAt: string | null;
  tokenId: string | null;
  tokenFromEnv: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function disconnect() {
    setBusy(true);
    await fetch("/api/paypal/disconnect", { method: "POST" });
    setBusy(false);
    router.refresh();
  }
  return (
    <section className="card flex flex-wrap items-center gap-4 p-5">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-2xl" aria-hidden>💳</div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">Company PayPal account</p>
        {props.connected ? (
          <>
            <p className="text-sm text-muted">
              Connected{props.email ? ` as ${props.email}` : ""} via PayPal Vault
              {props.connectedAt ? ` · ${new Date(props.connectedAt).toLocaleDateString()}` : ""}. Agents pay with this saved account; no card numbers are stored here.
            </p>
            {props.tokenId && !props.tokenFromEnv ? (
              <p className="mt-1 text-xs text-muted">
                Hosting on a server that resets its disk? Set <code>PAYPAL_PAYMENT_TOKEN_ID={props.tokenId}</code> in its environment to keep
                this connection after restarts.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">
            Connect once. PayPal saves the account in its Vault and gives Allowance a payment token, so agents can pay without anyone at the keyboard.
          </p>
        )}
      </div>
      {props.connected ? (
        <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
      ) : (
        <a className={`btn btn-primary ${props.configured ? "" : "pointer-events-none opacity-50"}`} href="/api/paypal/connect">
          Connect PayPal (sandbox)
        </a>
      )}
    </section>
  );
}
