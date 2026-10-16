import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { ApiError as GeminiApiError } from "@google/genai";
import { currentMember } from "@/lib/session";
import { aiConfigError, GeminiDailyQuotaError, runAgentTurn } from "@/lib/agent";

export const maxDuration = 300;

export async function POST(req: Request) {
  const member = await currentMember();
  if (!member) return NextResponse.json({ error: "Pick a persona first." }, { status: 401 });
  const configError = aiConfigError();
  if (configError) {
    return NextResponse.json({ error: `${configError} Add it to .env.local and restart.` }, { status: 500 });
  }
  const { conversationId, message } = (await req.json()) as { conversationId?: string; message?: string };
  if (!conversationId || !message?.trim()) {
    return NextResponse.json({ error: "conversationId and message are required." }, { status: 400 });
  }
  try {
    const out = await runAgentTurn(member, conversationId, message.trim().slice(0, 2000));
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof GeminiDailyQuotaError) {
      return NextResponse.json(
        { error: "The AI's free daily quota is used up. It resets at midnight Pacific time; try again later." },
        { status: 429 },
      );
    }
    const rateLimited =
      err instanceof Anthropic.RateLimitError || (err instanceof GeminiApiError && err.status === 429);
    if (rateLimited) {
      return NextResponse.json({ error: "The AI is rate limited right now. Try again in a moment." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError || (err instanceof GeminiApiError && (err.status === 401 || err.status === 403))) {
      return NextResponse.json({ error: "The AI API key was rejected." }, { status: 500 });
    }
    if (err instanceof Anthropic.APIError || err instanceof GeminiApiError) {
      return NextResponse.json({ error: `AI request failed: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
