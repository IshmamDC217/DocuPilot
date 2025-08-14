"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sendChat, type ChatMessage, detectCurl, renderMD } from "@/lib/chat";

type Usage = { count: number; cap: number; resetAtUTC: "00:00" };
type Health = { ok: boolean; usage: Usage; model?: string };

const BASE = process.env.NEXT_PUBLIC_WORKER_BASE_URL as string;
const STORAGE_KEY = "hlr-chat-history-v1";

type Item = { role: "user" | "assistant"; content: string; latency?: number };

export default function HLRChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Item[]>(() => loadHistory());
  const [status, setStatus] =
    useState<"idle" | "loading" | "ok" | "rejected" | "closed" | "error">("idle");
  const [reason, setReason] =
    useState<"daily_cap" | "provider_quota" | "off_topic" | "internal_error" | undefined>();
  const [usage, setUsage] = useState<Usage>({ count: 0, cap: 1000, resetAtUTC: "00:00" });
  const [lastCurl, setLastCurl] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Health on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/health`, { cache: "no-store" });
        const j = (await r.json()) as Health;
        if (j?.usage) setUsage(j.usage);
      } catch { }
    })();
  }, []);

  // Track last cURL
  useEffect(() => {
    const c = detectCurl(items.filter((i) => i.role === "assistant").slice(-1)[0]?.content ?? "");
    setLastCurl(c);
  }, [items]);

  // Persist history
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-40)));
    } catch { }
  }, [items]);

  // Copy buttons inside code blocks (event delegation)
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.classList.contains("copy-btn")) {
        const code = t.getAttribute("data-copy") || "";
        navigator.clipboard?.writeText(code);
        t.textContent = "Copied!";
        setTimeout(() => (t.textContent = "Copy"), 1000);
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  // Scroll tracking
  useEffect(() => {
    const scroller = listRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const nearBottom =
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 24;
      setShowScrollDown(!nearBottom);
    };
    scroller.addEventListener("scroll", onScroll);
    onScroll();
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);

  const disabled =
    status === "loading" || usage.count >= usage.cap || status === "closed" || reason === "provider_quota";

  async function onAsk(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    const text = (override ?? input).trim();
    if (!text || disabled) return;

    setStatus("loading");
    setReason(undefined);

    setItems((prev) => [...prev, { role: "user", content: text }]);
    setInput("");

    const messages: ChatMessage[] = [{ role: "user", content: text }];
    const t0 = performance.now();

    // abort per request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    try {
      const resp = await sendChat({ messages }, abortRef.current.signal);
      setUsage(resp.usage);

      if (resp.status === "ok") {
        setItems((prev) => [
          ...prev,
          { role: "assistant", content: resp.content, latency: performance.now() - t0 },
        ]);
        setStatus("ok");
      } else {
        setStatus(resp.status);
        setReason(resp.reason);
        const msg =
          resp.reason === "off_topic"
            ? "I only answer HLR Lookup docs/API questions."
            : resp.reason === "daily_cap"
              ? `We’re closed (daily cap reached). Resets at ${resp.usage.resetAtUTC} UTC.`
              : resp.reason === "provider_quota"
                ? "Provider quota reached. Please try again later."
                : "Service is unavailable right now.";
        setItems((prev) => [
          ...prev,
          { role: "assistant", content: msg, latency: performance.now() - t0 },
        ]);
      }
    } catch {
      setStatus("error");
      setItems((prev) => [
        ...prev,
        { role: "assistant", content: "Network error.", latency: performance.now() - t0 },
      ]);
    } finally {
      abortRef.current = null;
      requestAnimationFrame(() => snapToBottom());
    }
  }

  function onStop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus("idle");
  }

  function onRegenerate() {
    const lastUser = [...items].reverse().find((i) => i.role === "user");
    if (lastUser) onAsk(undefined, lastUser.content);
  }

  function onClearHistory() {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { }
    requestAnimationFrame(() => snapToBottom());
  }

  function snapToBottom() {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }

  const pct = Math.min(100, usage.cap ? Math.round((usage.count / usage.cap) * 100) : 0);
  const isOpen = usage.count < usage.cap && status !== "closed";

  return (
    <>
      {/* RIGHT: Assistant */}
      <section id="chatPanel" className={`panel chat-brand ${open ? "open" : ""}`}>
        {/* Header */}
        <header className="panel-header header-compact">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="bot-avatar" aria-hidden="true">
              <video className="avatar-video" src="/bot.mp4" autoPlay loop muted playsInline preload="metadata" />
            </span>
            <div className="panel-title">Darcy</div>
            <span className={`badge ${isOpen ? "ok" : "closed"}`}>{isOpen ? "Open" : "Closed"}</span>
            <span className="badge usage-pill">{usage.count}/{usage.cap} today</span>
          </div>
          <span className="grow" />
          <button className="icon-btn" onClick={() => setOpen(false)} title="Close" aria-label="Close">×</button>
        </header>


        {/* Usage bar */}
        <div style={{ borderColor: "var(--card-border)" }}>
          <div className="px-3 py-2">
            <div
              aria-label="usage"
              className="h-[6px] rounded-full"
              style={{ background: "var(--bubble-grey)" }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-200 ease-out"
                style={{
                  width: `${pct}%`,
                  background: pct >= 95 ? "var(--closed)" : "var(--ok)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="chat-body">
          <div id="messages" className="messages" aria-live="polite" ref={listRef}>
            {items.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "assistant" ? "justify-start" : "justify-end"}`}
              >
                {/* Assistant avatar on the left for assistant messages */}
                {m.role === "assistant" && (
                  <span className="mr-2 mt-1 hidden sm:inline-flex">
                    <span className="bot-avatar">
                      <video
                        className="avatar-video"
                        src="/bot.mp4"
                        autoPlay
                        loop
                        muted
                        playsInline
                        preload="metadata"
                      />
                    </span>
                  </span>
                )}

                <div
                  className={`msg ${m.role}`}
                  dangerouslySetInnerHTML={{ __html: renderMD(m.content) }}
                />
              </div>
            ))}

            {status === "loading" && (
              <div className="flex justify-start">
                <div className="msg assistant">
                  <span className="typing">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Scroll to bottom pill */}
          {showScrollDown && (
            <button
              onClick={snapToBottom}
              className="absolute right-5 bottom-28 z-10 rounded-full border px-3 py-1 text-sm"
              style={{ background: "#fff", borderColor: "var(--bubble-border)", boxShadow: "var(--shadow)" }}
              aria-label="Scroll to latest"
            >
              Jump to latest ↓
            </button>
          )}

          {/* Composer */}
          <div className="composer">
            <div className="input-wrap" style={{ width: "100%" }}>
              <textarea
                id="input"
                placeholder="Type your message here..."
                value={input}
                disabled={disabled}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onAsk(e as any);
                  }
                }}
              />
              <button
                id="sendBtn"
                title={status === "loading" ? "Stop" : "Send"}
                onClick={(e) => (status === "loading" ? onStop() : onAsk(e as any))}
                disabled={usage.count >= usage.cap}
              >
                {status === "loading" ? "■" : "➤"}
              </button>
            </div>

            {/* meta row */}
            <div className="meta">
              <div className="hint">
                Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for newline
              </div>

              {/* pushes the buttons to the right */}
              <div className="spacer" />

              <div className="meta-actions">
                <button className="chip" onClick={onClearHistory}>Clear</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAB + hint */}
      {!open && (
        <>
          <button id="botFab" aria-label="Open HLR Assistant" onClick={() => setOpen(true)}>
            <video className="fab-video" src="/bot.mp4" autoPlay loop muted playsInline preload="metadata" />
          </button>
          <div id="botHint">💬 Need help? Ask our AI assistant, Darcy!</div>
        </>
      )}
    </>
  );
}

function loadHistory(): Item[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      return arr
        .filter(
          (x) =>
            x &&
            typeof x === "object" &&
            (x.role === "user" || x.role === "assistant") &&
            typeof x.content === "string"
        )
        .slice(-40);
    }
  } catch { }
  return [];
}

function copy(text?: string | null) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => { });
}
