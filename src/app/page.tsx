import { getMembers, getTeams } from "@/lib/db";
import { PersonaPicker } from "@/components/PersonaPicker";
import { LogoMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default function Home() {
  const teams = Object.fromEntries(getTeams().map((t) => [t.id, t.name]));
  const members = getMembers().map((m) => ({ ...m, team: teams[m.team_id] }));
  return (
    <div className="mx-auto max-w-3xl">
      <section className="py-8 text-center">
        <div className="mb-4 flex justify-center"><LogoMark size={56} /></div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Your team&apos;s AI buyers. <span className="bg-gradient-to-r from-sky-500 to-indigo-500 bg-clip-text text-transparent">You set the rules.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
          Every teammate gets an AI buying agent that finds the best deal and pays with the company&apos;s PayPal account,
          without ever breaking the budgets and approval rules finance sets.
        </p>
      </section>
      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Try it as</h2>
        <p className="mt-1 text-sm text-muted">This demo has no passwords. Pick a persona; you can switch any time from the top-right.</p>
        <PersonaPicker members={members} />
      </section>
      <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["1. Finance sets rules", "Budgets per team, caps per category, an approval threshold, blocked categories."],
          ["2. Teammates just ask", "“Two 27-inch monitors under $450.” The agent searches real stores and recommends."],
          ["3. Code decides, PayPal pays", "In-policy orders are paid via PayPal instantly; bigger ones go to the manager."],
        ].map(([t, d]) => (
          <li key={t} className="card p-4">
            <p className="font-semibold">{t}</p>
            <p className="mt-1 text-muted">{d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
