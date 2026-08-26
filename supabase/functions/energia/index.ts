// Monitor de Energia — Tuya (medidor de rede) + SolisCloud (geração solar)
import { createClient } from "npm:@supabase/supabase-js@2";
import { md5 } from "npm:js-md5@0.8.3";

const APP_PASSWORD = Deno.env.get("APP_PASSWORD") ?? "";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/* ---------- configuracao ----------
   As credenciais ficam na tabela kv (chave "config"), editaveis pela tela de
   Ajustes. As variaveis de ambiente continuam valendo como valor inicial,
   para nao quebrar instalacoes existentes.                                   */
type Cred = {
  tuya: { id: string; key: string; device: string; base: string };
  solis: { id: string; secret: string; base: string; station: string; inverter: string; sn: string };
  auth: { salt: string; hash: string } | null;
  rev: number;
};

const PADRAO = (): Cred => ({
  tuya: {
    id: Deno.env.get("TUYA_ID") ?? "",
    key: Deno.env.get("TUYA_KEY") ?? "",
    device: Deno.env.get("TUYA_DEVICE") ?? "",
    base: Deno.env.get("TUYA_BASE") ?? "https://openapi.tuyaus.com",
  },
  solis: {
    id: Deno.env.get("SOLIS_KEY_ID") ?? "",
    secret: Deno.env.get("SOLIS_KEY_SECRET") ?? "",
    base: Deno.env.get("SOLIS_BASE") ?? "https://www.soliscloud.com:13333",
    station: Deno.env.get("SOLIS_STATION") ?? "",
    inverter: Deno.env.get("SOLIS_INVERTER") ?? "",
    sn: Deno.env.get("SOLIS_INVERTER_SN") ?? "",
  },
  auth: null,
  rev: 0,
});

let cfgCache: { v: Cred; exp: number } | null = null;

async function cfg(): Promise<Cred> {
  if (cfgCache && Date.now() < cfgCache.exp) return cfgCache.v;
  const base = PADRAO();
  const hit = await kvGet("config").catch(() => null);
  const g = (hit?.v ?? {}) as Partial<Cred>;
  const v: Cred = {
    tuya: { ...base.tuya, ...(g.tuya ?? {}) },
    solis: { ...base.solis, ...(g.solis ?? {}) },
    auth: g.auth ?? null,
    rev: Number(g.rev ?? 0),
  };
  cfgCache = { v, exp: Date.now() + 15_000 };
  return v;
}

async function salvarCfg(v: Cred) {
  v.rev = (v.rev ?? 0) + 1;
  await kvSet("config", v);
  cfgCache = { v, exp: Date.now() + 15_000 };
  // credenciais novas invalidam token e leituras em cache
  await sb.from("kv").delete().in("k", ["tuya_token", "solar", "fluxo"]);
  cache.clear();
  tuyaToken = null;
}

/* ---------- utilidades ---------- */
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256hex(s: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
async function hmac(algo: "SHA-256" | "SHA-1", key: string, msg: string) {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: algo }, false, ["sign"],
  );
  return await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

// cache compartilhado no banco: instâncias diferentes do edge não compartilham memória
async function kvGet(k: string): Promise<{ v: any; idade: number } | null> {
  const { data } = await sb.from("kv").select("v,updated_at").eq("k", k).maybeSingle();
  if (!data) return null;
  return { v: data.v, idade: Date.now() - new Date(data.updated_at).getTime() };
}
async function kvSet(k: string, v: unknown) {
  await sb.from("kv").upsert({ k, v, updated_at: new Date().toISOString() }, { onConflict: "k" });
}
// devolve o valor em cache na hora; se estiver velho, atualiza em segundo plano
async function kvSWR<T>(k: string, maxIdade: number, fn: () => Promise<T>): Promise<T> {
  const hit = await kvGet(k);
  const refresh = async () => { try { await kvSet(k, await fn()); } catch { /* mantém o antigo */ } };
  if (hit && hit.idade < maxIdade) return hit.v as T;
  if (hit) {
    // @ts-ignore runtime do Supabase
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(refresh()); else refresh();
    return hit.v as T;
  }
  const v = await fn(); await kvSet(k, v); return v;
}

// cache simples em memória
const cache = new Map<string, { v: unknown; exp: number }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.exp) return hit.v as T;
  const v = await fn();
  cache.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}

/* ---------- Tuya ---------- */
let tuyaToken: { token: string; exp: number } | null = null;

async function tuyaCall(method: string, path: string, token = "", cred?: Cred["tuya"]): Promise<any> {
  const c = cred ?? (await cfg()).tuya;
  if (!c.id || !c.key) throw new Error("Tuya sem credenciais: configure em Ajustes");
  const t = Date.now().toString();
  const body = await sha256hex("");
  const sign = hex(await hmac("SHA-256", c.key, c.id + token + t + `${method}\n${body}\n\n${path}`)).toUpperCase();
  const headers: Record<string, string> = { client_id: c.id, t, sign, sign_method: "HMAC-SHA256" };
  if (token) headers.access_token = token;
  const r = await fetch(c.base + path, { method, headers });
  return await r.json();
}

async function tuyaAuth(): Promise<string> {
  if (tuyaToken && Date.now() < tuyaToken.exp) return tuyaToken.token;
  const salvo = await kvGet("tuya_token");           // compartilhado entre instâncias
  if (salvo && Date.now() < Number(salvo.v.exp)) {
    tuyaToken = { token: String(salvo.v.token), exp: Number(salvo.v.exp) };
    return tuyaToken.token;
  }
  const r = await tuyaCall("GET", "/v1.0/token?grant_type=1");
  if (!r.success) throw new Error("tuya token: " + r.msg);
  tuyaToken = { token: r.result.access_token, exp: Date.now() + (r.result.expire_time - 600) * 1000 };
  await kvSet("tuya_token", tuyaToken);
  return tuyaToken.token;
}

function decodePhase(s: string) {
  const raw = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  if (raw.length < 8) return { v: 0, a: 0, w: 0 };
  return {
    v: ((raw[0] << 8) | raw[1]) / 10,
    a: ((raw[2] << 16) | (raw[3] << 8) | raw[4]) / 1000,
    w: (raw[5] << 16) | (raw[6] << 8) | raw[7],
  };
}

async function readMeter() {
  const tok = await tuyaAuth();
  const dev = (await cfg()).tuya.device;
  if (!dev) throw new Error("Tuya sem dispositivo: configure em Ajustes");
  const st = await tuyaCall("GET", `/v1.0/devices/${dev}/status`, tok);
  if (!st.success) throw new Error("tuya status: " + st.msg);
  const dp: Record<string, any> = {};
  for (const d of st.result) dp[d.code] = d.value;
  const a = decodePhase(String(dp["phase_a"] ?? ""));
  const b = decodePhase(String(dp["phase_b"] ?? ""));
  const c = decodePhase(String(dp["phase_c"] ?? ""));
  return {
    ts: new Date().toISOString(),
    phase_a: a, phase_b: b, phase_c: c,
    w_total: a.w + b.w + c.w,
    fwd_kwh: Number(dp["forward_energy_total"] ?? 0) / 100,
    rev_kwh: Number(dp["reverse_energy_total"] ?? 0) / 100,
    freq: Number(dp["supply_frequency"] ?? 0) / 100,
    fault: dp["fault"] ?? 0,
  };
}

/* ---------- SolisCloud ---------- */
async function solis(path: string, body: Record<string, unknown>, cred?: Cred["solis"]): Promise<any> {
  const c = cred ?? (await cfg()).solis;
  if (!c.id || !c.secret) throw new Error("SolisCloud sem credenciais: configure em Ajustes");
  const bs = JSON.stringify(body);
  const contentMd5 = b64(md5.arrayBuffer(bs));
  const date = new Date().toUTCString();
  const toSign = `POST\n${contentMd5}\napplication/json\n${date}\n${path}`;
  const sig = b64(await hmac("SHA-1", c.secret, toSign));
  const r = await fetch(c.base + path, {
    method: "POST",
    headers: {
      "Content-MD5": contentMd5,
      "Content-Type": "application/json",
      "Date": date,
      "Authorization": `API ${c.id}:${sig}`,
    },
    body: bs,
  });
  return await r.json();
}

async function solarFetch() {
  {
    const r = await solis("/v1/api/stationDetail", { id: (await cfg()).solis.station });
    const d = r?.data ?? {};
    const unit = String(d.powerStr ?? "kW");
    const mult = unit === "MW" ? 1e6 : unit === "W" ? 1 : 1000;
    return {
      w: Math.round(Number(d.power ?? 0) * mult),
      day_kwh: Number(d.dayEnergy ?? 0),
      month_kwh: Number(d.monthEnergy ?? 0),
      year_kwh: Number(d.yearEnergy ?? 0) * (String(d.yearEnergyStr) === "MWh" ? 1000 : 1),
      all_kwh: Number(d.allEnergy ?? 0) * (String(d.allEnergyStr) === "MWh" ? 1000 : 1),
      capacity_kwp: Number(d.capacity ?? 0),
      price: Number(d.price ?? 0),
      state: Number(d.state ?? 0), // 1=normal 2=offline 3=alarme
      updated: d.dataTimestampStr ?? null,
    };
  }
}
// leitura rápida: cache no banco, revalidado em segundo plano a cada 60s
async function solarNow() { return await kvSWR("solar", 60_000, solarFetch); }

async function inverterNow() {
  const sc = (await cfg()).solis;
  return await cached(`inv_${sc.inverter}_${sc.sn}`, 60_000, async () => {
    const r = await solis("/v1/api/inverterDetail", { id: sc.inverter, sn: sc.sn });
    const d = r?.data ?? {};
    const pacUnit = String(d.pacStr ?? "kW");
    return {
      w: Math.round(Number(d.pac ?? 0) * (pacUnit === "kW" ? 1000 : 1)),
      today_kwh: Number(d.etoday ?? 0),
      total_kwh: Number(d.etotal ?? 0),
      temp: Number(d.inverterTemperature ?? 0),
      fac: Number(d.fac ?? 0),
      state: Number(d.state ?? 0),
      nominal_kw: Number(d.power ?? 0),
      strings: [
        { u: Number(d.uPv1 ?? 0), i: Number(d.iPv1 ?? 0), w: Number(d.pow1 ?? 0) },
        { u: Number(d.uPv2 ?? 0), i: Number(d.iPv2 ?? 0), w: Number(d.pow2 ?? 0) },
      ],
      ac: { u: Number(d.uAc1 ?? 0), i: Number(d.iAc1 ?? 0) },
      updated: d.dataTimestampStr ?? null,
      sn: sc.sn,
    };
  });
}

// curva intradiária de geração (144 pontos)
async function solarCurve(day: string) {
  const st = (await cfg()).solis.station;
  return await cached(`curve_${st}_${day}`, 5 * 60_000, async () => {
    const r = await solis("/v1/api/stationDay", { id: st, money: "BRL", time: day, timeZone: -3 });
    const arr = Array.isArray(r?.data) ? r.data : [];
    return arr.map((x: any) => ({ t: x.timeStr?.slice(0, 5) ?? "", w: Math.round(Number(x.power ?? 0)) }))
      .filter((x: any) => x.t);
  });
}

// geração diária do mês  -> { "YYYY-MM-DD": kWh }
async function solarMonth(month: string): Promise<Record<string, number>> {
  const st = (await cfg()).solis.station;
  return await cached(`smonth_${st}_${month}`, 15 * 60_000, async () => {
    const r = await solis("/v1/api/stationMonth", { id: st, money: "BRL", month, timeZone: -3 });
    const out: Record<string, number> = {};
    for (const x of (Array.isArray(r?.data) ? r.data : [])) out[x.dateStr] = Number(x.energy ?? 0);
    return out;
  });
}

// geração mensal do ano -> { "YYYY-MM": kWh }
async function solarYear(year: string): Promise<Record<string, number>> {
  const st = (await cfg()).solis.station;
  return await cached(`syear_${st}_${year}`, 60 * 60_000, async () => {
    const r = await solis("/v1/api/stationYear", { id: st, money: "BRL", year, timeZone: -3 });
    const out: Record<string, number> = {};
    for (const x of (Array.isArray(r?.data) ? r.data : [])) out[x.dateStr] = Number(x.energy ?? 0);
    return out;
  });
}

/* ---------- combinação ---------- */
const brtNow = () => new Date(Date.now() - 3 * 3600e3);
const brtToday = () => brtNow().toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

// O medidor SPM02 só publica a MAGNITUDE de cada fase. Como o inversor é
// monofásico, algumas fases exportam enquanto outras importam no mesmo instante
// (as duas contagens de energia avançam juntas). Somar |A|+|B|+|C| superestima
// muito o fluxo real. A única fonte confiável são os contadores de energia, que
// avançam de 10 em 10 Wh — por isso medimos sobre uma janela móvel de ~60s.
type Fluxo = { ts: number; fwd: number; rev: number; impW: number; expW: number; ok: boolean };

async function gridFlow(fwd: number, rev: number, magW: number, gen: number) {
  const ref = await kvGet("fluxo");
  const agora = Date.now();

  if (!ref?.v?.ts) {
    const chute = gen > magW * 0.8 && gen > 200
      ? { impW: 0, expW: magW } : { impW: magW, expW: 0 };
    await kvSet("fluxo", { ts: agora, fwd, rev, ...chute, ok: false });
    return { ...chute, ok: false, janela: 0 };
  }

  const r = ref.v as Fluxo;
  const dt = (agora - Number(r.ts)) / 1000;
  const dF = fwd - Number(r.fwd);
  const dR = rev - Number(r.rev);

  let out: Fluxo = { ...r, ts: Number(r.ts) };
  let fechou = false;

  // Janela longa de propósito: o consumo da casa é a diferença entre dois números
  // grandes (geração e injeção). Com passo de 10 Wh, uma janela de 60s carrega
  // ~±600 W de erro; com 240s cai para ~±150 W.
  if (dt >= 240 && (dF + dR) >= 0.03) {
    const h = dt / 3600;
    const impNovo = Math.round(dF / h * 1000);
    const expNovo = Math.round(dR / h * 1000);
    const a = r.ok ? 0.6 : 1;                       // suavização exponencial
    out = {
      ts: agora, fwd, rev, ok: true,
      impW: Math.round(a * impNovo + (1 - a) * Number(r.impW || 0)),
      expW: Math.round(a * expNovo + (1 - a) * Number(r.expW || 0)),
    };
    fechou = true;
  } else if (dt >= 600) {
    // nada relevante se moveu em 10 min: fluxo praticamente nulo
    out = { ts: agora, fwd, rev, impW: 0, expW: 0, ok: true };
    fechou = true;
  }

  if (fechou) {
    const salvar = async () => await kvSet("fluxo", out);
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(salvar()); else salvar();
  }
  return { impW: out.impW, expW: out.expW, ok: out.ok, janela: Math.round(dt) };
}

// monta o retrato do fluxo a partir do medidor + geração
function montarFluxo(meter: any, gen: number, f: { impW: number; expW: number; ok: boolean; janela: number }) {
  const imp = Math.max(0, f.impW), exp = Math.max(0, f.expW);
  const casa = Math.max(0, gen + imp - exp);
  const casaSolar = Math.max(0, Math.min(gen, casa));
  const casaRede = Math.max(0, casa - casaSolar);
  return {
    ts: meter.ts,
    geracao_w: gen,
    importado_w: imp,
    injetado_w: exp,
    rede_w: imp - exp,
    casa_w: casa,
    casa_solar_w: casaSolar,
    casa_rede_w: casaRede,
    exportando: exp > imp,
    autossuficiencia: casa > 0 ? Math.round(100 * casaSolar / casa) : 0,
    aproveitamento: gen > 0 ? Math.round(100 * Math.min(1, casaSolar / gen)) : 0,
    fases: { a: meter.phase_a, b: meter.phase_b, c: meter.phase_c },
    medidor_w: meter.w_total,
    fluxo_ok: f.ok,
    janela_s: f.janela,
    freq: meter.freq,
    fwd_kwh: meter.fwd_kwh,
    rev_kwh: meter.rev_kwh,
  };
}

async function liveAll() {
  const [meter, solar] = await Promise.all([readMeter(), solarNow().catch(() => null)]);
  const gen = solar?.w ?? 0;
  const f = await gridFlow(meter.fwd_kwh, meter.rev_kwh, meter.w_total, gen);
  return {
    ...montarFluxo(meter, gen, f),
    solar_state: solar?.state ?? null,
    solar_updated: solar?.updated ?? null,
    price: solar?.price ?? 0,
    capacidade_kwp: solar?.capacity_kwp ?? 5.004,
  };
}

// série diária: rede (Tuya) + geração (Solis)
async function dailySeries(days: number) {
  const since = new Date(brtNow().getTime() - days * 86400e3).toISOString().slice(0, 10);
  const { data } = await sb.from("energy_daily").select("day,fwd_start,rev_start")
    .gte("day", since).order("day", { ascending: true });
  const rows = (data ?? []) as { day: string; fwd_start: number; rev_start: number }[];
  const meter = await readMeter();

  const meses = [...new Set(rows.map((r) => r.day.slice(0, 7)))];
  const ger: Record<string, number> = {};
  for (const m of meses) Object.assign(ger, await solarMonth(m));

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i], next = rows[i + 1];
    const fwdEnd = next ? Number(next.fwd_start) : meter.fwd_kwh;
    const revEnd = next ? Number(next.rev_start) : meter.rev_kwh;
    const importado = Math.max(0, r2(fwdEnd - Number(cur.fwd_start)));
    const injetado = Math.max(0, r2(revEnd - Number(cur.rev_start)));
    const geracao = r2(ger[cur.day] ?? 0);
    // falha de comunicação do inversor: geração < injeção é impossível
    const gerOk = geracao >= injetado * 0.95;
    const gerAdj = gerOk ? geracao : r2(injetado / 0.8);
    const autoc = Math.max(0, gerAdj - injetado);
    const casa = importado + autoc;
    out.push({
      day: cur.day,
      geracao: gerAdj,
      geracao_estimada: !gerOk && injetado > 0,
      importado,
      injetado,
      autoconsumo: r2(autoc),
      casa: r2(casa),
      autossuficiencia: casa > 0 ? Math.round(100 * autoc / casa) : 0,
      aproveitamento: gerAdj > 0 ? Math.round(100 * autoc / gerAdj) : 0,
    });
  }
  return out;
}

async function monthlySeries(months: number) {
  const anos = [...new Set(
    Array.from({ length: months }, (_, i) => {
      const d = new Date(brtNow().getFullYear(), brtNow().getMonth() - i, 1);
      return String(d.getFullYear());
    }),
  )];
  const ger: Record<string, number> = {};
  for (const y of anos) Object.assign(ger, await solarYear(y));

  const dias = await dailySeries(400);
  const tuya: Record<string, { importado: number; injetado: number; dias: number }> = {};
  for (const d of dias) {
    const m = d.day.slice(0, 7);
    tuya[m] ??= { importado: 0, injetado: 0, dias: 0 };
    tuya[m].importado += d.importado;
    tuya[m].injetado += d.injetado;
    tuya[m].dias += 1;
  }

  const cur = brtToday().slice(0, 7);
  const keys = [...new Set([...Object.keys(ger), ...Object.keys(tuya)])]
    .filter((m) => ger[m] > 0 || tuya[m])
    .sort().slice(-months);

  return keys.map((mes) => {
    const t = tuya[mes];
    const g = r2(ger[mes] ?? 0);
    const autoc = t ? Math.max(0, g - t.injetado) : 0;
    const casa = t ? t.importado + autoc : 0;
    return {
      mes,
      geracao: g,
      importado: t ? r2(t.importado) : null,
      injetado: t ? r2(t.injetado) : null,
      autoconsumo: t ? r2(autoc) : null,
      casa: t ? r2(casa) : null,
      autossuficiencia: t && casa > 0 ? Math.round(100 * autoc / casa) : null,
      dias_medidos: t?.dias ?? 0,
      parcial: mes === cur,
    };
  });
}

// consumo da casa separado por origem ao longo do dia,
// calculado por deltas de energia (robusto) + curva de geração da Solis
async function origemSerie(opts: { day?: string; horas?: number }) {
  let ini: string, fim: string;
  if (opts.horas) {
    fim = new Date().toISOString();
    ini = new Date(Date.now() - opts.horas * 3600e3).toISOString();
  } else {
    ini = `${opts.day}T03:00:00Z`;                       // 00:00 BRT
    fim = new Date(new Date(ini).getTime() + 86400e3).toISOString();
  }
  const { data } = await sb.from("energy_log").select("ts,fwd_kwh,rev_kwh,gen_w")
    .gte("ts", ini).lt("ts", fim).order("ts", { ascending: true }).limit(1200);
  const rows = (data ?? []) as { ts: string; fwd_kwh: number; rev_kwh: number; gen_w: number | null }[];
  if (rows.length < 2) return [];

  // a janela de 24h cruza a virada do dia -> curva de geracao dos dois dias
  const dias = new Set<string>();
  for (const r of rows) dias.add(new Date(new Date(r.ts).getTime() - 3 * 3600e3).toISOString().slice(0, 10));
  const mapaCurva = new Map<string, number>();
  for (const d of dias) {
    const c = await solarCurve(d).catch(() => [] as { t: string; w: number }[]);
    for (const x of c) mapaCurva.set(`${d} ${x.t}`, x.w);
  }
  // a curva da Solis vem a cada 10min; procura o ponto mais proximo
  const genEm = (loc: Date) => {
    const d = loc.toISOString().slice(0, 10);
    const hh = String(loc.getUTCHours()).padStart(2, "0");
    const mm = loc.getUTCMinutes();
    for (const off of [0, 10, -10, 20, -20]) {
      const m = Math.floor((mm + off) / 10) * 10;
      if (m >= 0 && m < 60) {
        const v = mapaCurva.get(`${d} ${hh}:${String(m).padStart(2, "0")}`);
        if (v !== undefined) return v;
      }
    }
    return null;
  };

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const dtH = (new Date(b.ts).getTime() - new Date(a.ts).getTime()) / 3600e3;
    if (dtH <= 0 || dtH > 0.5) continue;                // ignora buracos > 30min
    const imp = Math.max(0, Number(b.fwd_kwh) - Number(a.fwd_kwh));
    const inj = Math.max(0, Number(b.rev_kwh) - Number(a.rev_kwh));
    const bLocal = new Date(new Date(b.ts).getTime() - 3 * 3600e3);
    const gW = b.gen_w != null && Number(b.gen_w) > 0 ? Number(b.gen_w) : (genEm(bLocal) ?? 0);
    const gerKwh = (gW * dtH) / 1000;
    const solarCasa = Math.max(0, gerKwh - inj);
    out.push({
      t: bLocal.toISOString().slice(11, 16),
      iso: bLocal.toISOString().slice(0, 16),            // p/ eixo temporal de 24h
      solar: Math.round(solarCasa / dtH * 1000),        // W medios do sol p/ casa
      rede: Math.round(imp / dtH * 1000),               // W medios da rede
      geracao: Math.round(gW),
      injetado: Math.round(inj / dtH * 1000),
    });
  }
  return out;
}

/* ---------- HTTP ---------- */
// A senha fica no banco como PBKDF2-SHA256 (nunca em claro). Enquanto ninguem
// tiver definido uma, vale a variavel de ambiente APP_PASSWORD.
async function derivar(senha: string, salt: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations: 120_000, hash: "SHA-256" }, k, 256);
  return hex(bits);
}
const novoSalt = () => hex(crypto.getRandomValues(new Uint8Array(16)).buffer);

// comparacao em tempo constante
function igual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function conferirSenha(senha: string | null): Promise<boolean> {
  const c = await cfg();
  if (c.auth) {
    if (!senha) return false;
    return igual(await derivar(senha, c.auth.salt), c.auth.hash);
  }
  if (!APP_PASSWORD) return true;
  return !!senha && igual(senha, APP_PASSWORD);
}
const authed = (url: URL) => conferirSenha(url.searchParams.get("k"));
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const p = url.pathname.replace(/^\/energia\/?/, "");
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const isCron = (req.headers.get("authorization") ?? "").includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    if (req.method === "POST" && p === "api/collect") {
      if (!isCron && !(await authed(url))) return json({ error: "unauthorized" }, 401);
      const s = await readMeter();
      let gen = 0;
      try { gen = (await solarNow()).w; } catch { /* solar opcional */ }
      const { error } = await sb.from("energy_log").insert({
        va: s.phase_a.v, aa: s.phase_a.a, wa: s.phase_a.w,
        vb: s.phase_b.v, ab: s.phase_b.a, wb: s.phase_b.w,
        vc: s.phase_c.v, ac: s.phase_c.a, wc: s.phase_c.w,
        w_total: s.w_total, fwd_kwh: s.fwd_kwh, rev_kwh: s.rev_kwh, freq: s.freq,
        gen_w: gen,
      });
      if (error) return json(error, 500);
      return json({ ok: true, w: s.w_total, gen });
    }

    if (req.method === "POST" && p === "api/snapshot") {
      if (!isCron && !(await authed(url))) return json({ error: "unauthorized" }, 401);
      const s = await readMeter();
      const { error } = await sb.from("energy_daily")
        .upsert({ day: brtToday(), fwd_start: s.fwd_kwh, rev_start: s.rev_kwh }, { onConflict: "day" });
      if (error) return json(error, 500);
      return json({ ok: true, day: brtToday() });
    }

    if (!(await authed(url))) return json({ error: "unauthorized" }, 401);

    /* ---------- configuracao ---------- */
    // nunca devolve segredo em claro: so os ultimos 4 caracteres
    const mascara = (v: string) => (v ? "••••" + v.slice(-4) : "");

    if (p === "api/config" && req.method === "GET") {
      const c = await cfg();
      return json({
        tuya: { id: c.tuya.id, key: mascara(c.tuya.key), device: c.tuya.device, base: c.tuya.base },
        solis: { id: c.solis.id, secret: mascara(c.solis.secret), base: c.solis.base,
                 station: c.solis.station, inverter: c.solis.inverter, sn: c.solis.sn },
        senha_definida: !!c.auth,
        completo: !!(c.tuya.id && c.tuya.key && c.tuya.device),
        solar_ok: !!(c.solis.id && c.solis.secret && c.solis.station),
      });
    }

    if (p === "api/config" && req.method === "POST") {
      const b = await req.json().catch(() => ({})) as any;
      const c = await cfg();
      // campo em branco ou mascarado mantem o valor atual
      const mant = (novo: unknown, atual: string) => {
        const v = typeof novo === "string" ? novo.trim() : "";
        return !v || v.startsWith("••••") ? atual : v;
      };
      const nova: Cred = {
        tuya: {
          id: mant(b?.tuya?.id, c.tuya.id),
          key: mant(b?.tuya?.key, c.tuya.key),
          device: mant(b?.tuya?.device, c.tuya.device),
          base: mant(b?.tuya?.base, c.tuya.base) || "https://openapi.tuyaus.com",
        },
        solis: {
          id: mant(b?.solis?.id, c.solis.id),
          secret: mant(b?.solis?.secret, c.solis.secret),
          base: mant(b?.solis?.base, c.solis.base) || "https://www.soliscloud.com:13333",
          station: mant(b?.solis?.station, c.solis.station),
          inverter: mant(b?.solis?.inverter, c.solis.inverter),
          sn: mant(b?.solis?.sn, c.solis.sn),
        },
        auth: c.auth,
        rev: c.rev,
      };
      await salvarCfg(nova);
      return json({ ok: true });
    }

    if (p === "api/password" && req.method === "POST") {
      const b = await req.json().catch(() => ({})) as any;
      const nova = String(b?.nova ?? "");
      if (nova.length < 8) return json({ error: "A senha precisa de pelo menos 8 caracteres" }, 400);
      const c = await cfg();
      const salt = novoSalt();
      await salvarCfg({ ...c, auth: { salt, hash: await derivar(nova, salt) } });
      return json({ ok: true });
    }

    // testa as credenciais salvas e diz exatamente o que falhou
    if (p === "api/test") {
      const out: Record<string, unknown> = {};
      try {
        const m = await readMeter();
        out.tuya = { ok: true, w_total: m.w_total, importado_kwh: m.fwd_kwh, injetado_kwh: m.rev_kwh };
      } catch (e) { out.tuya = { ok: false, erro: String((e as Error).message ?? e) }; }
      try {
        const sN = await solarFetch();
        out.solis = { ok: true, w: sN.w, dia_kwh: sN.day_kwh, potencia_kwp: sN.capacity_kwp };
      } catch (e) { out.solis = { ok: false, erro: String((e as Error).message ?? e) }; }
      return json(out);
    }

    if (p === "api/live") return json(await liveAll());

    // leve: só o medidor Tuya, usa geração em cache. Para polling rápido.
    if (p === "api/meter") {
      const meter = await readMeter();
      const solar = await solarNow().catch(() => null);
      const gen = solar?.w ?? 0;
      const f = await gridFlow(meter.fwd_kwh, meter.rev_kwh, meter.w_total, gen);
      return json(montarFluxo(meter, gen, f));
    }

    if (p === "api/origem") {
      const h = Number(url.searchParams.get("horas") ?? 0);
      return json(h > 0
        ? await origemSerie({ horas: Math.min(h, 48) })
        : await origemSerie({ day: url.searchParams.get("day") ?? brtToday() }));
    }

    if (p === "api/today") {
      const [live, dias, c0] = await Promise.all([
        liveAll(), dailySeries(2), solarCurve(brtToday()).catch(() => []),
      ]);
      let curva = c0, curvaDia = brtToday();
      if (curva.filter((x: any) => x.w > 0).length < 3) {
        const ontem = new Date(brtNow().getTime() - 86400e3).toISOString().slice(0, 10);
        const c1 = await solarCurve(ontem).catch(() => []);
        if (c1.filter((x: any) => x.w > 0).length >= 3) { curva = c1; curvaDia = ontem; }
      }
      const hoje = dias.find((d) => d.day === brtToday()) ??
        { geracao: 0, importado: 0, injetado: 0, autoconsumo: 0, casa: 0 };
      const solar = await solarNow().catch(() => null);
      const gerHoje = solar?.day_kwh ?? hoje.geracao;
      const casaHoje = r2(hoje.importado + Math.max(0, gerHoje - hoje.injetado));
      const solarHoje = Math.max(0, r2(gerHoje - hoje.injetado));
      return json({
        live,
        hoje: {
          ...hoje, geracao: gerHoje, casa: casaHoje,
          casa_solar: solarHoje, casa_rede: hoje.importado,
          autossuficiencia: casaHoje > 0 ? Math.round(100 * solarHoje / casaHoje) : 0,
          aproveitamento: gerHoje > 0 ? Math.round(100 * solarHoje / gerHoje) : 0,
        },
        curva, curva_dia: curvaDia,
        economia: r2(gerHoje * (live.price || 0)),
        mes_kwh: solar?.month_kwh ?? 0,
        mes_brl: r2((solar?.month_kwh ?? 0) * (live.price || 0)),
        total_kwh: solar?.all_kwh ?? 0,
        total_brl: r2((solar?.all_kwh ?? 0) * (live.price || 0)),
      });
    }

    if (p === "api/daily") {
      return json(await dailySeries(Math.min(Number(url.searchParams.get("days") ?? 30), 365)));
    }

    if (p === "api/monthly") {
      return json(await monthlySeries(Math.min(Number(url.searchParams.get("months") ?? 12), 36)));
    }

    if (p === "api/inverter") {
      const [inv, solar] = await Promise.all([inverterNow(), solarNow()]);
      return json({ ...inv, planta: solar });
    }

    if (p === "api/phases") {
      const hours = Math.min(Number(url.searchParams.get("hours") ?? 24), 24 * 30);
      const since = new Date(Date.now() - hours * 3600e3).toISOString();
      const { data, error } = await sb.from("energy_log")
        .select("ts,wa,wb,wc,w_total,gen_w").gte("ts", since).order("ts", { ascending: true }).limit(3000);
      if (error) return json(error, 500);
      return json(data);
    }

    if (p === "api/summary") {
      const dias = await dailySeries(70);
      const hoje = dias.find((d) => d.day === brtToday()) ??
        { geracao: 0, importado: 0, injetado: 0, autoconsumo: 0, casa: 0 };
      const mes = brtToday().slice(0, 7);
      const doMes = dias.filter((d) => d.day.startsWith(mes));
      const sum = (k: keyof typeof dias[0]) => r2(doMes.reduce((a, d) => a + (Number(d[k]) || 0), 0));
      const solar = await solarNow().catch(() => null);
      return json({
        hoje: { ...hoje, saldo: r2(hoje.injetado - hoje.importado) },
        mes: {
          geracao: solar?.month_kwh ?? sum("geracao"),
          importado: sum("importado"), injetado: sum("injetado"),
          casa: sum("casa"), saldo: r2(sum("injetado") - sum("importado")),
          dias: doMes.length,
        },
        media_dia: doMes.length ? r2(sum("casa") / doMes.length) : 0,
      });
    }

    return json({ ok: true, endpoints: ["api/live", "api/meter", "api/origem", "api/today", "api/daily", "api/monthly", "api/inverter", "api/phases", "api/summary", "api/config", "api/password", "api/test"] });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
