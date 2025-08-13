export interface Env {
	AI: any;
	USAGE: KVNamespace;
  
	MODEL: string;
	DAILY_CAP: string;
	MAX_TOKENS: string;
	ALLOWED_ORIGINS: string;
	ALLOW_OFFTOPIC: string;
	USE_OPENAI_COMPAT: string;
	TIMEZONE: string;
  
	// Optional for AI Gateway path (leave unset if not using)
	GATEWAY_URL?: string;
	ACCOUNT_ID?: string;
	CF_API_TOKEN?: string;
  }
  
  type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
  
  type UnifiedResponse =
	| { status: 'ok'; content: string; usage: { count: number; cap: number; resetAtUTC: '00:00' } }
	| {
		status: 'closed' | 'rejected' | 'error';
		reason: 'daily_cap' | 'provider_quota' | 'off_topic' | 'internal_error';
		usage: { count: number; cap: number; resetAtUTC: '00:00' };
		content?: string;
	  };
  
  const RESET_AT_UTC: '00:00' = '00:00';
  
  export default {
	async fetch(request: Request, env: Env): Promise<Response> {
	  const url = new URL(request.url);
  
	  if (url.pathname === '/api/health' && request.method === 'GET') {
		return json({ ok: true, usage: await usageState(env), model: env.MODEL }, 200, { 'Cache-Control': 'no-store' });
	  }
  
	  if (url.pathname === '/api/chat') {
		if (request.method === 'OPTIONS') return handleOptions(request, env);
		if (request.method !== 'POST') {
		  return corsJson(
			request,
			env,
			{ status: 'error', reason: 'internal_error', usage: await usageState(env) },
			405,
			{ 'Allow': 'POST, OPTIONS', 'Cache-Control': 'no-store' }
		  );
		}
		return handleChat(request, env);
	  }
  
	  return new Response('Not Found', { status: 404 });
	}
  } satisfies ExportedHandler<Env>;
  
  async function handleChat(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get('Origin') || '';
	if (!isAllowedOrigin(origin, env)) return new Response('Forbidden', { status: 403 });
  
	// Parse body
	let body: any = {};
	try { body = await request.json(); } catch {}
	const messages: ChatMessage[] = normalizeMessages(body);
	const latestUser = messages.slice().reverse().find((m) => m.role === 'user')?.content || '';
  
	// Fast on-topic guard
	if (!isTrue(env.ALLOW_OFFTOPIC)) {
	  if (fastTopicGate(latestUser) !== 'allow') {
		return corsJson(
		  request,
		  env,
		  { status: 'rejected', reason: 'off_topic', usage: await usageState(env) },
		  200,
		  { 'Cache-Control': 'no-store' }
		);
	  }
	}
  
	// Check daily cap BEFORE model call
	const { overCap, count } = await incrementAndCheck(env);
	if (overCap) {
	  return corsJson(
		request,
		env,
		{ status: 'closed', reason: 'daily_cap', usage: { count, cap: getCap(env), resetAtUTC: RESET_AT_UTC } },
		429,
		{ 'Cache-Control': 'no-store' }
	  );
	}
  
	// Compose prompt
	const sys =
	  `You are "HLR Lookup Assistant". Be concise.\n` +
	  `- Provide runnable curl when asked.\n` +
	  `- Ask for missing required params.\n` +
	  `- Stay on HLR Lookup docs/API topics.\n`;
  
	const composed: ChatMessage[] = [{ role: 'system', content: sys }, ...truncateForBudget(messages)];
	const max_tokens = num(env.MAX_TOKENS, 300);
  
	try {
	  let content = '';
  
	  // Workers AI binding (default)
	  if (!isTrue(env.USE_OPENAI_COMPAT)) {
		const result = await env.AI.run(env.MODEL, {
		  messages: composed,
		  max_tokens,
		  temperature: 0.2,
		  stream: false
		});
		content =
		  typeof result?.response === 'string'
			? result.response
			: (result?.result ?? result?.text ?? '');
	  } else {
		// Optional OpenAI-compatible via AI Gateway
		const gw = env.GATEWAY_URL || '';
		const key = env.CF_API_TOKEN || '';
		if (!gw || !key) throw new Error('AI Gateway not configured');
  
		const resp = await fetch(`${gw}/v1/chat/completions`, {
		  method: 'POST',
		  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
		  body: JSON.stringify({ model: env.MODEL, messages: composed, temperature: 0.2, max_tokens, stream: false })
		});
  
		if (resp.status === 429 || resp.status === 403) {
		  return corsJson(
			request,
			env,
			{ status: 'closed', reason: 'provider_quota', usage: await usageState(env) },
			429,
			{ 'Cache-Control': 'no-store' }
		  );
		}
		if (!resp.ok) throw new Error(`gateway_${resp.status}`);
		const j = await resp.json();
		content = j?.choices?.[0]?.message?.content ?? '';
	  }
  
	  if (!content) throw new Error('empty_response');
  
	  return corsJson(
		request,
		env,
		{ status: 'ok', content, usage: await usageState(env) },
		200,
		{ 'Cache-Control': 'no-store' }
	  );
	} catch (e: any) {
	  const msg = String(e?.message || e);
	  const quotaLike = /quota|limit|exhaust|rate.?limit|insufficient|credits/i.test(msg);
	  const body: UnifiedResponse = quotaLike
		? { status: 'closed', reason: 'provider_quota', usage: await usageState(env) }
		: { status: 'error', reason: 'internal_error', usage: await usageState(env) };
	  return corsJson(request, env, body, quotaLike ? 429 : 500, { 'Cache-Control': 'no-store' });
	}
  }
  
  /** ---------- helpers ---------- **/
  function isTrue(v?: string) { return String(v || '').toLowerCase() === 'true'; }
  function num(v?: string, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
  function getCap(env: Env) { return num(env.DAILY_CAP, 1000); }
  
  function getToday(env: Env) {
	const tz = env.TIMEZONE || 'UTC';
	const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
	return s; // YYYY-MM-DD
  }
  
  async function usageState(env: Env) {
	const key = `${getToday(env)}:global`;
	const val = await env.USAGE.get(key, 'text');
	const count = val ? Number(val) || 0 : 0;
	return { count, cap: getCap(env), resetAtUTC: '00:00' as const };
  }
  
  async function incrementAndCheck(env: Env) {
	const key = `${getToday(env)}:global`;
	const cap = getCap(env);
	const current = await env.USAGE.get(key, 'text');
	const count = current ? Number(current) || 0 : 0;
	const next = count + 1;
	await env.USAGE.put(key, String(next), { expirationTtl: 60 * 60 * 48 });
	return { overCap: next > cap, count: next };
  }
  
  function isAllowedOrigin(origin: string, env: Env) {
	if (!origin) return false;
	const allow = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
	return allow.includes(origin);
  }
  
  function handleOptions(request: Request, env: Env) {
	const origin = request.headers.get('Origin') || '';
	if (!isAllowedOrigin(origin, env)) {
	  return new Response(null, {
		status: 204,
		headers: { 'Access-Control-Allow-Origin': 'null', 'Vary': 'Origin', 'Access-Control-Max-Age': '86400' }
	  });
	}
	return new Response(null, {
	  status: 204,
	  headers: {
		'Access-Control-Allow-Origin': origin,
		'Vary': 'Origin',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Max-Age': '86400'
	  }
	});
  }
  
  function corsHeaders(request: Request, env: Env, extra?: HeadersInit) {
	const origin = request.headers.get('Origin') || '';
	const headers: HeadersInit = { 'Vary': 'Origin', ...(extra || {}) };
	if (isAllowedOrigin(origin, env)) headers['Access-Control-Allow-Origin'] = origin;
	return headers;
  }
  function corsJson(request: Request, env: Env, obj: any, status = 200, extra?: HeadersInit) {
	return new Response(JSON.stringify(obj), { status, headers: corsHeaders(request, env, { 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) }) });
  }
  function json(obj: any, status = 200, extra?: HeadersInit) {
	return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extra || {}) } });
  }
  
  function normalizeMessages(body: any): ChatMessage[] {
	const msgs: ChatMessage[] = Array.isArray(body?.messages)
	  ? body.messages
		  .filter((m: any) => m && typeof m.role === 'string' && typeof m.content === 'string')
		  .map((m: any) => ({ role: m.role, content: m.content }))
	  : [];
	if (!msgs.length && typeof body?.text === 'string') msgs.push({ role: 'user', content: body.text });
	return msgs.slice(0, 24);
  }
  
  function truncateForBudget(messages: ChatMessage[]): ChatMessage[] {
	const MAX_CHARS = 4000;
	const out: ChatMessage[] = [];
	let budget = MAX_CHARS;
	for (let i = messages.length - 1; i >= 0; i--) {
	  const m = messages[i];
	  const s = m.content || '';
	  if (s.length <= budget) {
		out.unshift(m);
		budget -= s.length;
	  } else {
		out.unshift({ role: m.role, content: s.slice(-budget) });
		budget = 0;
		break;
	  }
	  if (budget <= 0) break;
	}
	return out;
  }
  
  type GateVerdict = 'allow' | 'reject' | 'ambiguous';
  function fastTopicGate(text: string): GateVerdict {
	if (!text) return 'ambiguous';
	const t = text.toLowerCase();
	const allow = [
	  /\bhlr\b/, /\bhome\s*location\s*register\b/, /\blookup\b/, /\bmsisdn\b/, /\bimsi\b/,
	  /\bmccmnc\b/, /\bapi\b/, /\bendpoint\b/, /\bwebhook\b/, /\bpricing\b/, /\bauth(entication| token| header)?\b/,
	  /\bcurl\b/, /\bintegration\b/, /\bcarrier\b/, /\bnumber\s*(validation|lookup)\b/, /\bstatus\s*codes?\b/
	];
	for (const p of allow) if (p.test(t)) return 'allow';
	const reject = [/\brecipe|cooking|travel|weather|movie|joke|poem|story|song\b/, /\bhomework|math|biology|history\b/];
	for (const p of reject) if (p.test(t)) return 'reject';
	return 'reject';
  }
  