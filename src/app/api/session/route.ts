import { NextResponse } from "next/server";
import { getMember } from "@/lib/db";
import { setCurrentMember } from "@/lib/session";

export async function POST(req: Request) {
  const { memberId } = (await req.json()) as { memberId?: string };
  const member = memberId ? getMember(memberId) : undefined;
  if (!member) return NextResponse.json({ error: "Unknown member." }, { status: 400 });
  await setCurrentMember(member.id);
  const home = member.role === "TEAMMATE" ? "/agent" : member.role === "MANAGER" ? "/approvals" : "/admin";
  return NextResponse.json({ member, home });
}
