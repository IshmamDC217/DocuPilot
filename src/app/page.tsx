"use client";

import { useEffect, useMemo, useState } from "react";
import { sendChat, type ChatMessage } from "@/lib/chat";

type Usage = { count: number; cap: number; resetAtUTC: "00:00" };
type Health = { ok: boolean; usage: Usage; model?: string };

const BASE = process.env.NEXT_PUBLIC_WORKER_BASE_URL as string;

export default function Home() {
  // Chat state
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [items, setItems] = useState<Array<{ role: "user" | "assistant"; content: string; latency?: number }>>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "rejected" | "closed" | "error">("idle");
  const [reason, setReason] = useState<"daily_cap" | "provider_quota" | "off_topic" | "internal_error" | undefined>(undefined);
  const [usage, setUsage] = useState<Usage>({ count: 0, cap: 1000, resetAtUTC: "00:00" });

  // Health fetch
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${BASE}/api/health`, { cache: "no-store" });
        const j = (await r.json()) as Health;
        if (j?.usage) setUsage(j.usage);
      } catch { }
    })();
  }, []);

  const lastCurl = useMemo(() => detectCurl(items.filter(i => i.role === "assistant").slice(-1)[0]?.content ?? ""), [items]);

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    setStatus("loading");
    setReason(undefined);

    const userMsg = input.trim();
    setItems(prev => [...prev, { role: "user", content: userMsg }]);
    setInput("");

    const messages: ChatMessage[] = [{ role: "user", content: userMsg }];
    const t0 = performance.now();

    try {
      const resp = await sendChat({ messages });
      setUsage(resp.usage);

      if (resp.status === "ok") {
        setItems(prev => [...prev, { role: "assistant", content: resp.content, latency: performance.now() - t0 }]);
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
        setItems(prev => [...prev, { role: "assistant", content: msg, latency: performance.now() - t0 }]);
      }
    } catch {
      setStatus("error");
      setItems(prev => [...prev, { role: "assistant", content: "Network error.", latency: performance.now() - t0 }]);
    }
  }

  const disabled =
    status === "loading" ||
    usage.count >= usage.cap ||
    status === "closed" ||
    reason === "provider_quota";

  return (
    <main className="app">
      {/* LEFT: Knowledge UI (static replica for now) */}
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="kb-wrap">
          <aside className="kb-sidebar">
            <div className="kb-head">
              <svg xmlns="http://www.w3.org/2000/svg" width="147" height="42" viewBox="0 0 147 42" fill="none"><path d="M4.77152 36.7766H0L3.50574 16.9012H8.25189L7.06345 23.7538C7.52351 22.9941 8.156 22.3533 8.90973 21.8833C9.7373 21.3903 10.6885 21.1437 11.6514 21.1725C13.427 21.1725 14.6579 21.7653 15.3442 22.951C16.0305 24.1367 16.206 25.7055 15.8707 27.6575L14.2622 36.7766H9.40858L10.8835 28.4213C11.0604 27.4383 11.0357 26.6675 10.8162 26.1159C10.5963 25.5608 10.0468 25.2838 9.16792 25.2849C8.28716 25.2849 7.5691 25.6172 7.11294 26.2855C6.60629 27.0854 6.27367 27.9829 6.13669 28.9197L4.76368 36.7723L4.77152 36.7766Z" fill="white"></path><path d="M20.5362 16.9012H25.3889L21.8801 36.7764H17.0273L20.5331 16.9012H20.5362Z" fill="white"></path><path d="M24.7983 36.7766L27.4864 21.4873H31.3347L31.4409 24.6237C31.8972 23.428 32.5433 22.5712 33.3794 22.0532C34.2141 21.5378 35.3248 21.2754 36.7148 21.2754H37.5318L36.6616 26.3094H35.0275C34.6132 26.3068 34.1994 26.3376 33.7901 26.4014C33.4549 26.454 33.1271 26.5466 32.8139 26.6772C32.2777 26.8989 31.8388 27.3054 31.5766 27.8228C31.2458 28.5114 31.0148 29.2436 30.8905 29.9973L29.7043 36.7731H24.7983V36.7766Z" fill="white"></path><path d="M39.9863 17.3502H43.4419L40.0145 36.7764H36.5589L39.9863 17.3502Z" fill="white"></path><path d="M48.6238 36.8826C47.6387 36.6288 46.7339 36.1296 45.9941 35.4315C45.2543 34.7334 44.7036 33.8592 44.3934 32.8907C43.9666 31.4755 43.8937 29.9773 44.1812 28.5275L44.2059 28.3966C44.3363 27.68 44.5353 26.9776 44.8003 26.2992C45.0455 25.6763 45.3687 25.087 45.7623 24.5454C46.4831 23.5055 47.4534 22.6632 48.5844 22.0955C49.7574 21.5215 51.0491 21.2319 52.3549 21.2503C53.1721 21.2412 53.9871 21.3338 54.7813 21.5261C55.4761 21.6988 56.1365 21.9883 56.7342 22.3823C57.8527 23.1137 58.6856 24.2073 59.0934 25.4797C59.5425 26.8057 59.6085 28.3473 59.2914 30.1047L59.2666 30.2356C58.8817 32.3607 57.9986 34.0473 56.6173 35.2954C55.236 36.5436 53.3862 37.1671 51.0677 37.1659C50.2451 37.1753 49.4247 37.0778 48.6271 36.876L48.6238 36.8826ZM54.4103 32.8626C55.1496 32.0459 55.6412 30.9521 55.8852 29.5813L55.91 29.4504C56.2071 27.7285 56.0054 26.4285 55.3051 25.5504C54.6012 24.6736 53.5991 24.2338 52.2986 24.231C51.7382 24.2123 51.1797 24.3066 50.6565 24.5083C50.1333 24.71 49.656 25.0149 49.2532 25.4049C48.4537 26.1863 47.922 27.3508 47.6581 28.8983L47.6333 29.0292C47.3859 30.5214 47.5908 31.7414 48.2382 32.6818C48.889 33.6224 49.9431 34.0928 51.4003 34.0928C52.6665 34.0928 53.6687 33.6837 54.4068 32.8657L54.4103 32.8626Z" fill="white"></path><path d="M65.9234 36.8826C64.9382 36.6288 64.0335 36.1296 63.2937 35.4315C62.5539 34.7334 62.0032 33.8592 61.693 32.8907C61.2662 31.4755 61.1933 29.9773 61.4808 28.5274L61.5055 28.3965C61.6359 27.68 61.835 26.9776 62.1 26.2991C62.3453 25.6762 62.6685 25.087 63.0621 24.5454C63.7829 23.5053 64.7534 22.6628 65.8846 22.0951C67.0575 21.5211 68.3493 21.2315 69.6551 21.2498C70.4722 21.2407 71.2873 21.3334 72.0815 21.5257C72.7762 21.6985 73.4364 21.9882 74.034 22.3822C75.1525 23.1137 75.9854 24.2073 76.3932 25.4797C76.8423 26.8057 76.9084 28.3473 76.5913 30.1047L76.5666 30.2356C76.1816 32.3606 75.2985 34.0472 73.9173 35.2954C72.536 36.5436 70.6862 37.1671 68.3677 37.1659C67.545 37.1753 66.7246 37.0778 65.9271 36.876L65.9234 36.8826ZM71.7099 32.8626C72.4491 32.0459 72.9408 30.9521 73.1848 29.5813L73.2095 29.4504C73.5066 27.7285 73.305 26.4285 72.6047 25.5504C71.9008 24.6736 70.8986 24.2338 69.5982 24.231C69.0378 24.2123 68.4793 24.3066 67.956 24.5083C67.4328 24.71 66.9556 25.0149 66.5527 25.4048C65.7533 26.1863 65.2215 27.3508 64.9574 28.8983L64.9327 29.0292C64.6852 30.5214 64.8902 31.7414 65.5375 32.6818C66.1884 33.6224 67.2424 34.0927 68.6997 34.0927C69.966 34.0927 70.9682 33.6837 71.7062 32.8657L71.7099 32.8626Z" fill="white"></path><path d="M82.1692 32.5863L81.4299 36.7764H78.1087L81.5113 17.3502H84.8327L82.7777 29.0257L83.4888 28.3149L90.8987 21.6217H95.1961L88.4723 27.6043L92.4798 36.7764H88.8154L85.756 29.3687L82.1692 32.5828V32.5863Z" fill="white"></path><path d="M104.986 34.1954C104.516 35.0513 103.836 35.773 103.009 36.2922C102.167 36.8296 101.127 37.0947 99.8962 37.0947C99.2789 37.103 98.6631 37.0317 98.064 36.8826C97.5696 36.7623 97.1066 36.5382 96.7058 36.225C95.9424 35.6327 95.4257 34.7786 95.2557 33.8276C95.0446 32.6682 95.053 31.4794 95.2804 30.323L96.8085 21.6246H100.264L98.7857 30.0577C98.5558 31.359 98.616 32.3701 98.9555 33.0882C99.2992 33.8096 100.086 34.1703 101.315 34.1703C102.546 34.1703 103.451 33.7565 104.084 32.9333C104.717 32.106 105.175 30.9545 105.457 29.4788L106.829 21.6257H110.309L107.646 36.7802H104.905L104.983 34.1954H104.986Z" fill="white"></path><path d="M116.896 36.225C116.008 35.6612 115.36 34.788 115.078 33.7744L113.628 41.9999H110.306L113.946 21.6261H116.663L116.584 24.4998C117.05 23.5424 117.771 22.7314 118.667 22.1555C119.579 21.5579 120.686 21.2597 121.988 21.261C122.845 21.256 123.693 21.4307 124.478 21.7737C125.269 22.1236 125.961 22.6627 126.494 23.3435C127.076 24.1509 127.468 25.0792 127.64 26.0592C127.86 27.1482 127.838 28.4483 127.573 29.9594C127.455 30.6251 127.287 31.2811 127.071 31.9217C126.87 32.5192 126.615 33.0968 126.308 33.6472C125.749 34.6773 124.942 35.5513 123.959 36.1895C122.993 36.8118 121.825 37.1241 120.453 37.1265C118.993 37.1265 117.806 36.8283 116.895 36.232L116.896 36.225ZM122.591 32.9579C123.347 32.1128 123.849 30.9883 124.094 29.5846C124.391 27.8627 124.206 26.5449 123.538 25.6314C122.871 24.7179 121.869 24.2606 120.532 24.2595C119.962 24.2399 119.394 24.3442 118.869 24.5652C118.343 24.7862 117.871 25.1186 117.486 25.5395C116.705 26.3916 116.181 27.5466 115.916 29.0047C115.831 29.4654 115.787 29.9328 115.785 30.4014C115.783 30.8268 115.827 31.2512 115.916 31.6671C116.06 32.4055 116.463 33.0685 117.051 33.5376C117.631 33.9937 118.431 34.2223 119.45 34.2234C120.787 34.2234 121.832 33.8015 122.587 32.9577L122.591 32.9579Z" fill="white"></path><path d="M119.453 11.5965L131.44 12.4947L130.899 5.27173L119.177 9.68092C118.966 9.76066 118.789 9.91 118.674 10.1043C118.559 10.2985 118.514 10.5261 118.547 10.7494C118.579 10.9727 118.686 11.1783 118.851 11.3323C119.016 11.4863 119.228 11.5795 119.453 11.5965Z" fill="#FF2D46"></path><path d="M133.442 12.6442L141.546 13.2489L146.027 1.33984C146.094 1.16158 146.108 0.967757 146.068 0.781575C146.028 0.595393 145.935 0.424747 145.8 0.290072C145.666 0.155398 145.495 0.0624046 145.309 0.0222291C145.122 -0.0179464 144.928 -0.00360098 144.75 0.0635474L132.837 4.54345L133.442 12.6442Z" fill="#FF2D46"></path><path d="M136.406 26.9007L140.817 15.1828L133.591 14.6418L134.489 26.6251C134.506 26.8506 134.599 27.0638 134.753 27.2292C134.907 27.3946 135.113 27.5024 135.337 27.5346C135.561 27.5668 135.789 27.5215 135.984 27.4062C136.178 27.291 136.328 27.1127 136.407 26.9009L136.406 26.9007Z" fill="#FF2D46"></path></svg>
            </div>
            <div className="kb-search"><input placeholder="Search…" /></div>
            <div className="kb-section-title">Getting Started</div>
            <ul className="kb-nav">
              <li><a className="kb-item active" href="#"><span className="kb-bullet" /><span>Introduction</span></a></li>
              <li><a className="kb-item" href="#"><span className="kb-bullet" /><span>Coverage</span></a></li>
              <li><a className="kb-item" href="#"><span className="kb-bullet" /><span>API Testing Suite</span></a></li>
            </ul>
          </aside>

          <div className="kb-content">
            <div className="kb-topbar">
              <div className="kb-h1">Getting Started</div>
              <div className="kb-version">v1 / v2</div>
            </div>
            <div className="kb-scroll">
              <section className="kb-card">
                <h3>Introduction</h3>
                <p>The following documentation will enable you to get started with HLR Lookup's easy to use APIs. Our APIs allow you to integrate obtaining the status of your phone numbers into your code or internal infrastructure.</p>
                <div className="kb-hr" />
                <p>If you have questions not covered here, see the <a href="#" target="_blank" rel="noreferrer">FAQ</a> or contact support.</p>
              </section>
              <section className="kb-card">
                <h3>Coverage</h3>
                <p>We constantly review routing and introduce new countries and networks. Check our <a href="#" target="_blank" rel="noreferrer">Coverage Checker</a> to verify a destination.</p>
                <div className="kb-hr" />
                <p>If no coverage is available you won't be charged; responses may include <code>NO_COVERAGE</code> or <code>NOT_AVAILABLE_NETWORK_ONLY</code>.</p>
              </section>
              <section className="kb-card">
                <h3>API Testing Suite</h3>
                <pre><code>https://testing.hlrlookup.com/api/hlr
                  api_key: speedtest
                  api_secret: speedtest</code></pre>
                <p>Example:</p>
                <pre><code>{`curl -s -H "Content-Type: application/json" \\
  -X POST -d '{"api_key":"speedtest","api_secret":"speedtest","request":{"telephone_number":"447113097871"}}' \\
  https://testing.hlrlookup.com/api/hlr`}</code></pre>
              </section>
            </div>
          </div>
        </div>
      </section>

      {/* RIGHT: Assistant */}
      <section id="chatPanel" className={`panel ${open ? "open" : ""}`}>
        <header className="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="bot-avatar" aria-hidden="true"></span>
              <div className="panel-title">HLR Assistant</div>
            </div>
            <span className={`badge ${badgeOpen(status, usage) ? "ok" : "closed"}`}>
              {badgeOpen(status, usage) ? "Open" : "Closed"}
            </span>
            <span className="badge">{usage.count}/{usage.cap} today</span>
          </div>
          <span className="grow" />
          <div className="chat-toolbar">
            <button className="btn" onClick={() => copy(lastCurl)} disabled={!lastCurl}>Copy last cURL</button>
            <button className="btn" onClick={() => setOpen(false)} title="Close">×</button>
          </div>
        </header>

        <div className="chat-body">
          <div id="messages" className="messages" aria-live="polite">
            {items.map((m, i) => (
              <div key={i} className={`msg ${m.role}`} dangerouslySetInnerHTML={{ __html: renderMD(m.content) }} />
            ))}
          </div>

          <div className="composer">
            <div className="input-wrap" style={{ width: "100%" }}>
              <textarea
                id="input"
                placeholder="Message HLR Assistant… (Shift+Enter = newline)"
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
              <button id="sendBtn" title="Send" onClick={(e) => onAsk(e as any)} disabled={disabled}>➤</button>
            </div>
          </div>
        </div>
      </section>

      {/* FAB + hint */}
      {!open && (
        <>
          <button id="botFab" aria-label="Open HLR Assistant" onClick={() => setOpen(true)}>
            <video
              className="fab-video"
              src="/bot.mp4"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
            />
          </button>
          <div id="botHint">💬 Need help? Ask our AI assistant!</div>
        </>
      )}
    </main>
  );
}

/* ----- helpers ----- */
function badgeOpen(status: string, usage: Usage) {
  if (usage.count >= usage.cap) return false;
  if (status === "closed") return false;
  return true;
}
function copy(text?: string | null) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => { });
}
function escapeHTML(str: string) {
  return str.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch as '"' | "&" | "<" | ">"]));
}
function renderMD(text: string) {
  let out = escapeHTML(text || "");
  out = out.replace(/```([\s\S]*?)```/g, (_m, c) => `<pre><code>${c.replace(/^[\n]*|[\n]*$/g, "")}</code></pre>`);
  out = out.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  out = out.replace(/(https?:\/\/[^\s<]+[^<.,:;\s\)]?)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\n/g, "<br>");
  return out;
}
function detectCurl(t: string) {
  const fenced = t.match(/```[\s\S]*?```/);
  if (fenced) {
    const code = fenced[0].replace(/```/g, "").trim();
    const m = code.match(/(^|\n)\s*(curl\s[^\n]+)/i);
    if (m) return m[2];
  }
  const bare = t.match(/(^|\n)\s*(curl\s[^\n]+)/i);
  return bare ? bare[2] : null;
}
