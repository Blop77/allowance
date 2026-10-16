import { NextResponse } from "next/server";
import { getMembers, getPurchases, getTeams } from "@/lib/db";
import { currentMember } from "@/lib/session";

export async function GET() {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "Pick a persona first." }, { status: 401 });
  const teams = Object.fromEntries(getTeams().map((t) => [t.id, t.name]));
  const people = Object.fromEntries(getMembers().map((m) => [m.id, m.name]));
  const scope = member.role === "ADMIN" ? undefined : { teamId: member.team_id };
  const rows = getPurchases(scope).map((p) => ({ ...p, team: teams[p.team_id], requester: people[p.member_id] }));
  return NextResponse.json({ rows });
}
