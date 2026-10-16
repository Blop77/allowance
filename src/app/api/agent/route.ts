import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { currentMember } from "@/lib/session";
import { runAgentTurn } from "@/lib/agent";

export const maxDuration = 120;

export async function POST(req: Request) {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "Pick a persona first." }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart." }, { status: 500 });
  }
  const { conversationId, message } = (await req.json()) as { conversationId?: string; message?: string };
  if (!conversationId || !message?.trim()) {
    return NextResponse.json({ error: "conversationId and message are required." }, { status: 400 });
  }
  try {
    const out = await runAgentTurn(member, conversationId, message.trim().slice(0, 2000));
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "The AI is rate limited right now. Try again in a moment." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: "The Anthropic API key was rejected." }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `AI request failed: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
