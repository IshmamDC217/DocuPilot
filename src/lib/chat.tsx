// src/lib/chat.ts
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatPayload = { messages: ChatMessage[] };

export type ChatResponse =
  | {
      status: "ok";
      content: string;
      usage: { count: number; cap: number; resetAtUTC: "00:00" };
    }
  | {
      status: "closed" | "rejected" | "error";
      reason: "daily_cap" | "provider_quota" | "off_topic" | "internal_error";
      usage: { count: number; cap: number; resetAtUTC: "00:00" };
      content?: string;
    };

const base = process.env.NEXT_PUBLIC_WORKER_BASE_URL;

export async function sendChat(payload: ChatPayload, signal?: AbortSignal): Promise<ChatResponse> {
  if (!base) throw new Error("NEXT_PUBLIC_WORKER_BASE_URL is not set");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
    cache: "no-store",
  });

  // Normalize JSON either way (200/4xx still returns JSON by contract)
  const data = (await res.json()) as ChatResponse;
  return data;
}
