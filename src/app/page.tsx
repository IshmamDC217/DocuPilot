"use client";

import { useState } from "react";
import { sendChat, type ChatMessage } from "@/lib/chat";

export default function Home() {
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [status, setStatus] = useState<string>("idle");

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setAnswer("");

    const messages: ChatMessage[] = [
      { role: "user", content: input || "How do I call the HLR Lookup API?" },
    ];

    try {
      const resp = await sendChat({ messages });
      if (resp.status === "ok") {
        setAnswer(resp.content);
        setStatus(`ok (${resp.usage.count}/${resp.usage.cap})`);
      } else {
        setStatus(`${resp.status}:${resp.reason} (${resp.usage.count}/${resp.usage.cap})`);
        setAnswer(
          resp.reason === "off_topic"
            ? "I only answer HLR Lookup docs/API questions."
            : "Service is unavailable right now."
        );
      }
    } catch (err) {
      setStatus("error");
      setAnswer("Network error.");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1>HLR Assistant (Next.js + TS)</h1>
      <form onSubmit={onAsk} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about HLR Lookup API…"
          style={{ flex: 1, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <button type="submit" style={{ padding: "10px 14px", borderRadius: 8 }}>
          Ask
        </button>
      </form>

      <div style={{ marginTop: 24, color: "#666" }}>status: {status}</div>

      {answer && (
        <pre
          style={{
            marginTop: 12,
            whiteSpace: "pre-wrap",
            background: "#fafafa",
            border: "1px solid #eee",
            padding: 12,
            borderRadius: 8,
          }}
        >
          {answer}
        </pre>
      )}

      <p style={{ marginTop: 24, fontSize: 12 }}>
        Worker: <code>{process.env.NEXT_PUBLIC_WORKER_BASE_URL}/api/chat</code>
      </p>
    </main>
  );
}
