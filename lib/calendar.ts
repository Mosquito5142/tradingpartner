/**
 * ดึงปฏิทินเศรษฐกิจ
 *
 * แหล่งหลัก  : TradingView (ฟรี ไม่ต้องใช้ API key ดึงล่วงหน้าได้หลายเดือน)
 * แหล่งสำรอง : ForexFactory / FairEconomy (ได้เฉพาะสัปดาห์ปัจจุบัน ตั้งชื่อข่าวคนละแบบ)
 *
 * ข้อควรระวัง: TradingView จะ "ตัดข้อมูลเงียบ ๆ" ถ้าขอช่วงเวลายาวเกินไป
 * เวลาดึงย้อนหลังไกลต้องวนขอทีละ 60 วัน (ดู fetchRange)
 */

import type { CalendarEvent, CalendarResult } from "./types";

const TV_URL = "https://economic-calendar.tradingview.com/events";
const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const UA = "Mozilla/5.0 (compatible; GoldNewsCalendar/2.0)";

/** ForexFactory ใช้รหัสสกุลเงิน แต่ TradingView ใช้รหัสประเทศ */
const CCY_TO_COUNTRY: Record<string, string> = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CHF: "CH",
  CAD: "CA", AUD: "AU", NZD: "NZ", CNY: "CN",
};

const IMPACT_TO_IMPORTANCE: Record<string, number> = {
  high: 1, medium: 0, low: -1, holiday: -1,
};

/** แปลงตัวเลขดิบเป็นข้อความอ่านง่าย: 162 + K -> "162K", -88.6 + $ + B -> "-$88.6B" */
function fmtValue(value: unknown, unit = "", scale = ""): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") return value.trim();
  if (typeof value !== "number" || !Number.isFinite(value)) return "";

  const num = String(Number(value.toPrecision(12)));
  const u = (unit || "").trim();
  const s = (scale || "").trim();

  if (u === "%") return `${num}${s}%`;
  if (u === "$") return `${value < 0 ? "-" : ""}$${num.replace("-", "")}${s}`;
  if (u) return `${num}${s} ${u}`.trim();
  return `${num}${s}`;
}

const isoZ = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000Z");

/** ปฏิทินเปลี่ยนไม่บ่อย — cache 5 นาที เพื่อไม่ให้ยิง API ต้นทางทุกครั้งที่มีคนเปิดหน้าเว็บ */
const CALENDAR_TTL = 300;

async function httpGet(url: string, headers: Record<string, string> = {}, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      signal: controller.signal,
      next: { revalidate: CALENDAR_TTL },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

interface TVItem {
  id?: string; title?: string; indicator?: string; country?: string;
  importance?: number; category?: string; period?: string; source?: string;
  unit?: string; scale?: string; date: string;
  actual?: number | null; forecast?: number | null; previous?: number | null;
  actualRaw?: number | null; forecastRaw?: number | null; previousRaw?: number | null;
}

/** ดึงจาก TradingView ช่วงเดียว (ไม่ควรเกิน ~60 วัน) */
export async function fetchTradingView(from: Date, to: Date, countries: string[]): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({
    from: isoZ(from),
    to: isoZ(to),
    countries: countries.join(","),
  });
  const raw = await httpGet(`${TV_URL}?${query}`, { Origin: "https://www.tradingview.com" });
  const payload = JSON.parse(raw) as { status?: string; result?: TVItem[] };
  if (payload.status !== "ok") throw new Error(`TradingView ตอบกลับผิดปกติ: ${payload.status}`);

  return (payload.result || []).map((item) => {
    const unit = item.unit || "";
    const scale = item.scale || "";
    return {
      id: String(item.id ?? `${item.date}:${item.title}`),
      title: item.title || "",
      indicator: item.indicator || item.title || "",
      country: item.country || "",
      importance: Number(item.importance ?? -1),
      category: item.category || "",
      period: item.period || "",
      source: item.source || "",
      actual: fmtValue(item.actual, unit, scale),
      forecast: fmtValue(item.forecast, unit, scale),
      previous: fmtValue(item.previous, unit, scale),
      actualRaw: item.actual ?? null,
      forecastRaw: item.forecast ?? null,
      previousRaw: item.previous ?? null,
      ts: Math.floor(Date.parse(item.date) / 1000),
    };
  });
}

/**
 * ดึงย้อนหลังไกลโดยวนทีละช่วง — จำเป็นเพราะ API ตัดข้อมูลถ้าขอยาวเกิน
 * (ขอ 2 ปีรวดเดียวได้กลับมาแค่ ~3 เดือน)
 */
export async function fetchRange(daysBack: number, daysAhead: number, countries: string[]): Promise<CalendarEvent[]> {
  const now = Date.now();
  const byId = new Map<string, CalendarEvent>();
  const CHUNK = 60;

  const windows: [Date, Date][] = [];
  for (let back = 0; back < Math.max(daysBack, 1); back += CHUNK) {
    windows.push([
      new Date(now - (back + CHUNK) * 86400_000),
      new Date(now - back * 86400_000),
    ]);
  }
  if (daysAhead > 0) {
    windows.push([new Date(now), new Date(now + daysAhead * 86400_000)]);
  }

  const results = await Promise.allSettled(
    windows.map(([from, to]) => fetchTradingView(from, to, countries)),
  );
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const event of result.value) byId.set(event.id, event);
    }
  }
  return [...byId.values()].sort((a, b) => a.ts - b.ts);
}

interface FFItem {
  title?: string; country?: string; date: string;
  impact?: string; forecast?: string; previous?: string;
}

/** แหล่งสำรอง — ได้เฉพาะสัปดาห์ปัจจุบัน */
export async function fetchForexFactory(): Promise<CalendarEvent[]> {
  const payload = JSON.parse(await httpGet(FF_URL)) as FFItem[];
  return payload.map((item) => {
    const ccy = (item.country || "").toUpperCase();
    return {
      id: `ff:${item.date}:${item.title}`,
      title: item.title || "",
      indicator: item.title || "",
      country: CCY_TO_COUNTRY[ccy] || ccy,
      importance: IMPACT_TO_IMPORTANCE[(item.impact || "").toLowerCase()] ?? -1,
      category: "",
      period: "",
      source: "ForexFactory",
      actual: "",
      forecast: (item.forecast || "").trim(),
      previous: (item.previous || "").trim(),
      actualRaw: null,
      forecastRaw: null,
      previousRaw: null,
      ts: Math.floor(Date.parse(item.date) / 1000),
    };
  });
}

/** โหลดปฏิทินสำหรับหน้าเว็บ — ลอง TradingView ก่อน ถ้าล่มค่อยใช้ ForexFactory */
export async function loadCalendar(
  daysBack: number,
  daysAhead: number,
  countries: string[],
): Promise<CalendarResult> {
  const errors: string[] = [];
  const now = Date.now();

  try {
    const events = await fetchTradingView(
      new Date(now - daysBack * 86400_000),
      new Date(now + daysAhead * 86400_000),
      countries,
    );
    if (events.length) {
      return { events, source: "TradingView", fetchedAt: Math.floor(now / 1000), stale: false, errors };
    }
    errors.push("TradingView: ไม่มีข้อมูลส่งกลับมา");
  } catch (err) {
    errors.push(`TradingView: ${(err as Error).message}`);
  }

  try {
    const events = await fetchForexFactory();
    if (events.length) {
      return { events, source: "ForexFactory", fetchedAt: Math.floor(now / 1000), stale: true, errors };
    }
  } catch (err) {
    errors.push(`ForexFactory: ${(err as Error).message}`);
  }

  return { events: [], source: "ไม่มีข้อมูล", fetchedAt: Math.floor(now / 1000), stale: true, errors };
}
