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

/** Simple jittered delay */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fancy fetch with:
 * - abort (caller-provided signal)
 * - client-side timeout
 * - small retry (429/5xx) with backoff
 */
export async function sendChat(
  payload: ChatPayload,
  signal?: AbortSignal,
  { timeoutMs = 25_000, retries = 1 }: { timeoutMs?: number; retries?: number } = {}
): Promise<ChatResponse> {
  if (!base) throw new Error("NEXT_PUBLIC_WORKER_BASE_URL is not set");

  let attempt = 0;
  // outer loop for retries
  while (true) {
    attempt++;

    // composed abort: external + timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);

      // Contract: server always returns JSON in error states too.
      const data = (await res.json()) as ChatResponse;

      // If provider/edge cap returns 429-equivalent shape, just bubble up.
      if (!res.ok && attempt <= retries && shouldRetry(res.status, data)) {
        const backoff = 500 * attempt + Math.floor(Math.random() * 200);
        await sleep(backoff);
        continue;
      }

      return data;
    } catch (err: any) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);

      if (err?.name === "AbortError") {
        // Surface a consistent shape to the UI
        return {
          status: "error",
          reason: "internal_error",
          usage: { count: 0, cap: 0, resetAtUTC: "00:00" },
          content: "Request was cancelled.",
        };
      }

      if (attempt <= retries) {
        const backoff = 600 * attempt + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }

      return {
        status: "error",
        reason: "internal_error",
        usage: { count: 0, cap: 0, resetAtUTC: "00:00" },
        content: "Network error.",
      };
    }
  }
}

function shouldRetry(status: number, data?: ChatResponse): boolean {
  if (status >= 500 && status < 600) return true;
  // if the server gave a generic internal error, we can retry once
  if (data && data.status === "error" && data.reason === "internal_error") return true;
  return false;
}

/* ---------- Handy helpers shared by the UI ---------- */

export function detectCurl(t: string): string | null {
  const fenced = t.match(/```[\s\S]*?```/);
  if (fenced) {
    const code = fenced[0].replace(/```/g, "").trim();
    const m = code.match(/(^|\n)\s*(curl\s[^\n]+)/i);
    if (m) return m[2];
  }
  const bare = t.match(/(^|\n)\s*(curl\s[^\n]+)/i);
  return bare ? bare[2] : null;
}

export function escapeHTML(str: string) {
  return str.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch as any]));
}

export function renderMD(text: string) {
  let out = escapeHTML(text || "");
  // fenced first
  out = out.replace(/```([\s\S]*?)```/g, (_m, c) => {
    const code = String(c ?? "").replace(/^[\n]*|[\n]*$/g, "");
    // wrap with a toolbar so we can attach a copy button
    return `<div class="code-wrap"><button class="copy-btn" data-copy="${escapeHTML(
      code.replace(/"/g, "&quot;")
    )}">Copy</button><pre><code>${code}</code></pre></div>`;
  });
  // inline code
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  // links
  out = out.replace(/(https?:\/\/[^\s<]+[^<.,:;\s\)])?/g, (url) =>
    url ? `<a href="${url}" target="_blank" rel="noopener">${url}</a>` : ""
  );
  // newlines
  out = out.replace(/\n/g, "<br>");
  return out;
}
