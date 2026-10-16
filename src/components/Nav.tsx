import Link from "next/link";
import { currentMember } from "@/lib/session";
import { getTeam } from "@/lib/db";
import { LogoMark } from "./Logo";

export async function Nav() {
  const member = await currentMember();
  const team = member ? getTeam(member.team_id) : undefined;
  const links =
    member?.role === "ADMIN"
      ? [
          { href: "/admin", label: "Rules & PayPal" },
          { href: "/approvals", label: "Approvals" },
          { href: "/ledger", label: "Ledger" },
        ]
      : member?.role === "MANAGER"
        ? [
            { href: "/approvals", label: "Approvals" },
            { href: "/ledger", label: "Team ledger" },
          ]
        : member
          ? [
              { href: "/agent", label: "Buying agent" },
              { href: "/ledger", label: "Team ledger" },
            ]
          : [];
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <LogoMark size={30} /> Allowance
        </Link>
        <nav className="flex flex-wrap gap-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200 sm:inline">
            PayPal sandbox
          </span>
          {member ? (
            <Link href="/" className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-100" title="Switch persona">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-xs font-bold text-indigo-700">
                {member.name.split(" ").map((p) => p[0]).join("")}
              </span>
              <span className="leading-tight">
                <span className="block font-semibold">{member.name}</span>
                <span className="block text-xs text-muted">{member.title} · {team?.name}</span>
              </span>
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}
