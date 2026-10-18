# Allowance

**Give every teammate an AI buying agent. It finds the best deal, pays with your company's PayPal, and never breaks the budgets or approval rules you set.**

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (2026). Runs entirely on the **PayPal sandbox**: no real money moves.

**▶ [Watch the demo video (3:19)](https://youtu.be/UdF54f_yXSk)** · **🌐 [Try the live demo](https://allowance-trqr.onrender.com)** (PayPal sandbox; the free server may take about a minute to wake up)

[![Allowance demo video](docs/video-thumbnail.png)](https://youtu.be/UdF54f_yXSk)

## The problem

On small teams, buying a monitor or a software seat means waiting for whoever holds the company card, or paying yourself and filing an expense report weeks later. Finance only finds out after the money is gone. AI agents could do the buying, but nobody wants to hand an AI the company card with no rules.

## What Allowance does

| Who | What they do |
|---|---|
| **Teammate** | Asks in plain English: *"I need a 27-inch 4K monitor for design work, under \$600."* The agent searches real stores, recommends one with a reason, checks it against the rules, and buys it after the teammate confirms. |
| **Finance admin** | Connects the company PayPal account once (PayPal Vault), then sets per-team monthly budgets, an approval threshold, per-category caps, and blocked categories. |
| **Manager** | Gets anything over the threshold in an approvals queue. One tap approves and pays, or declines. |
| **Everyone** | Sees a live spend ledger (AG Grid): who bought what, from which budget, with the PayPal order ID. |

### The key design choice

**The AI decides *what* to buy. Code decides *whether* it's allowed.** The model can only pass the ID of a search result it was shown; the price, category and decision come from the server. A purchase of price $p$ for team $t$ is paid automatically only if:

- the category isn't blocked and $p \le$ the category's per-item cap,
- $S_t + p \le B_t$ (spend committed this month plus this item stays within the team budget), and
- $p \le A_t$ (the team's approval threshold).

If only the threshold fails, it goes to the manager. Otherwise it's refused, and the agent explains which rule blocked it. The rules engine is a pure function with unit tests: [`src/lib/policy.ts`](src/lib/policy.ts).

## How it uses PayPal

All calls are in [`src/lib/paypal.ts`](src/lib/paypal.ts), against `api-m.sandbox.paypal.com`.

| PayPal capability | How Allowance uses it |
|---|---|
| **OAuth 2.0 client credentials** | Server-side access token, cached until expiry. |
| **Vault API v3: setup tokens and payment tokens** | The admin approves saving the company PayPal account once. Allowance stores only the resulting payment token, never credentials. This is what lets an agent pay with no human at the keyboard. |
| **Orders API v2** | Each approved purchase creates an order with `payment_source.paypal.vault_id` and captures it. The purchase ID is the `PayPal-Request-Id`, so a retry can never double-charge. |
| **Webhooks + signature verification** | `PAYMENT.CAPTURE.COMPLETED / DENIED / REFUNDED / PENDING` events update the ledger, so it reflects what PayPal actually settled. Events are verified with `/v1/notifications/verify-webhook-signature` and de-duplicated. |

## How it uses AI

| Tool | Use |
|---|---|
| **Google Gemini (`gemini-3.5-flash`, falling back to `gemini-3.5-flash-lite`; free tier)**, the default | The buying agent. It runs a function-calling loop ([`src/lib/agent.ts`](src/lib/agent.ts)) with three tools: `search_products`, `check_policy` and `place_order`. It compares options, explains its pick, tells the teammate upfront whether the purchase will be paid, need approval or be refused, and only orders after explicit confirmation. Tool inputs are validated with Zod before anything runs. Short free-tier rate limits are waited out automatically; when a model's daily free quota runs out, the agent switches to the fallback model. |
| **Claude (Anthropic API, `claude-opus-5-5`)**, optional | The same agent and the same tools on Claude, with strict tool schemas. Set `AI_PROVIDER=claude` and `ANTHROPIC_API_KEY`. |
| **Channel3 product search API**, optional | `search_products` calls Channel3 for real, structured product data (title, store, price, availability, buy link) across thousands of retailers, so the agent never invents products or prices. Without a `CHANNEL3_API_KEY`, a small built-in sample catalog is used and the UI labels it as such. |

Both AI providers share one tool layer and one rules engine, so switching the model can't change what is allowed to be bought.

## Architecture

```mermaid
flowchart LR
  T[Teammate chat] --> A[AI agent: Gemini or Claude<br/>function-calling loop]
  A -- search_products --> C[Channel3 API]
  A -- check_policy / place_order --> P[Rules engine<br/>policy.ts]
  P -- in policy --> O[PayPal Orders v2<br/>vault_id]
  P -- over threshold --> Q[Manager approvals]
  Q -- approve --> O
  ADM[Finance admin] -- connect once --> V[PayPal Vault v3]
  V --> O
  O --> L[(SQLite ledger)]
  W[PayPal webhooks] --> L
  L --> G[AG Grid ledger]
```

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind, Node's built-in SQLite (`node:sqlite`, nothing native to install), `@google/genai`, `@anthropic-ai/sdk`, AG Grid Community, Zod.

## Run it locally

**Requirements:** Node.js 22.13 or newer.

```bash
git clone https://github.com/blop77/allowance.git
cd allowance
npm install
cp .env.example .env.local   # then fill in the keys below
npm run dev                  # http://localhost:3000
```

### Keys (all free)

1. **Gemini API key:** [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → `GEMINI_API_KEY`. The free tier is enough.
2. **PayPal sandbox app:** go to [developer.paypal.com](https://developer.paypal.com/) → Apps & Credentials → **Sandbox** → Create App. Copy the **Client ID** and **Secret** into `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. In the app's features, make sure **Save payment methods** (Vault) is enabled. Use **United States** sandbox accounts (the business account behind the app and the personal buyer): PayPal doesn't support saving a PayPal account for future payments in some regions, such as India.
3. **Channel3 (optional):** [trychannel3.com/developers](https://trychannel3.com/developers) → `CHANNEL3_API_KEY`.
4. **Claude (optional):** `AI_PROVIDER=claude` plus `ANTHROPIC_API_KEY` (and `ANTHROPIC_WORKSPACE_ID` if your key isn't scoped to a workspace).
5. **Webhooks (optional, needs a public URL):** in your sandbox app, add a webhook to `<APP_URL>/api/paypal/webhook` for the `PAYMENT.CAPTURE.*` events and put its ID in `PAYPAL_WEBHOOK_ID`.

The database is created and seeded automatically on first run (`./data/allowance.db`). Delete that file to reset the demo.

### Try the full flow (about 3 minutes)

There are no passwords; pick a persona on the home page.

1. **Morgan Lee (Finance admin)** → *Rules & PayPal* → **Connect PayPal (sandbox)**. Log in with a **US sandbox personal (buyer) account** (developer dashboard → Testing Tools → Sandbox Accounts) and approve. Optionally tweak budgets and caps.
2. **Priya Shah (Design teammate)** → *Buying agent* → *"I need a 27-inch monitor for design work, under \$300"*. The agent recommends one under the \$300 threshold → reply *"yes, buy it"* → it's **paid instantly** and shows the PayPal order ID.
3. Ask for *"an ergonomic office chair"*. Anything over \$300 goes to **approval**.
4. Ask for *"a \$100 Amazon gift card for a client"*. It's **refused**: gift cards are blocked.
5. **Sam Rivera (Design lead)** → *Approvals* → **Approve & pay**.
6. *Ledger* shows every request with its status, PayPal order ID and reason.

## Deploy a live demo on Render (free)

The repo includes a [Render Blueprint](render.yaml).

1. On [render.com](https://render.com), sign in with GitHub, then **New → Blueprint** and pick this repository.
2. Fill in the secrets it asks for: `GEMINI_API_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` (the others are optional; leave them empty). Click **Apply**. The first build takes a few minutes.
3. Open the URL Render gives you (like `https://allowance-xxxx.onrender.com`), pick **Morgan Lee**, and **Connect PayPal (sandbox)** once.
4. The admin page then shows a `PAYPAL_PAYMENT_TOKEN_ID=...` line. In Render → your service → **Environment**, set `PAYPAL_PAYMENT_TOKEN_ID` to that value (and `PAYPAL_ACCOUNT_EMAIL` to the sandbox buyer email), then save. Now PayPal stays connected even after restarts.

Free-tier notes: the service sleeps after 15 minutes without visitors (the next visit takes about a minute to wake it), and the database resets on each restart, so the ledger starts empty again. Everyone shares the one Gemini free-tier quota.

The hosted demo is shared, so the home page and the admin page have a **Reset demo** button: it puts budgets, rules and the ledger back to their starting state and keeps PayPal connected. When the PayPal connection comes from `PAYPAL_PAYMENT_TOKEN_ID`, it can't be disconnected from the app, so one visitor can't break payments for everyone.

### Tests

```bash
npm test          # rules engine unit tests
npm run typecheck
```

## Limitations (honest list)

- **Sandbox money only.** Real products from Channel3 are shown and linked, but payments go to the sandbox merchant behind your sandbox app; nothing is shipped. A production version would pay each store's PayPal checkout or a purchasing partner.
- **Demo sign-in.** Personas are picked from a list; there are no real accounts.
- **Category is chosen by the agent** from a fixed list when it searches. The system prompt forbids miscategorizing, and caps and budgets still apply, but a production version should categorize from the product data.
- **Webhooks need a public URL.** Locally, the ledger is updated from the capture response instead.

## What's next

Per-person budgets, recurring software seats, Slack approvals, PayPal Payouts to reimburse out-of-pocket purchases under the same rules, and anomaly alerts on unusual spend.

## License

[MIT](LICENSE)
