import "server-only";
import { cookies } from "next/headers";
import { getMember, type Member } from "./db";

// Demo sign-in: judges pick a persona; no passwords. The cookie only selects which seeded member you act as.
const COOKIE = "allowance_member";

export async function currentMember(): Promise<Member | undefined> {
  const id = (await cookies()).get(COOKIE)?.value;
  return id ? getMember(id) : undefined;
}

export async function setCurrentMember(id: string) {
  (await cookies()).set(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
