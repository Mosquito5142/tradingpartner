/**
 * ราคาทอง
 *
 * ทำไมต้องปรับฐาน:
 *   ทองล่วงหน้า COMEX (GC=F) แพงกว่า spot ราว $35 — ถ้าเอามาคำนวณแนวรับแนวต้านตรง ๆ
 *   เส้นจะเพี้ยนทั้งกระดานเมื่อวาดลงกราฟ XAUUSD ของโบรกเกอร์
 *
 * จึงใช้ PAXG (โทเคนทองคำ 1 ออนซ์ ห่าง spot ~$5) เป็นแท่งเทียน
 *   + ปรับฐานด้วยราคา spot จริง -> เหลือคลาดเคลื่อน ~$1-2
 *   + brokerOffset -> ตรงกับกราฟที่ผู้ใช้ดูจริง
 *
 * ส่วนการวัดปฏิกิริยาข่าวและโปรไฟล์รายชั่วโมงใช้ GC=F เพราะเป็นตลาดทองจริง
 * ที่ข่าววิ่งเข้าโดยตรง และวัดแค่ "ส่วนต่าง" ระดับราคาจึงไม่สำคัญ
 */

import { isMarketOpen } from "./time";
import type { Bar } from "./types";

const SPOT_URL = "https://api.gold-api.com/price/XAU";
const PAXG_URL = "https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=15m&limit=1000";
const GCF_URL = "https://query1.finance.yahoo.com/v8/finance/chart/GC=F";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

/**
 * อายุ cache ของแต่ละแหล่ง — ตั้งให้พอดีกับความถี่ที่ข้อมูลเปลี่ยนจริง
 * ราคาปัจจุบันสดหน่อย ส่วนแท่งเทียนย้อนหลังไม่ต้อง เพราะแท่งใหม่เกิดทุก 15 นาทีอยู่แล้ว
 */
const TTL = { spot: 60, bars: 120, history: 300 };

async function getJson<T>(url: string, timeoutMs = 25_000, revalidate = TTL.bars): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
      next: { revalidate },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** ราคา spot ทองคำล่าสุด (ดอลลาร์ต่อออนซ์) */
export async function fetchSpot(): Promise<number> {
  const data = await getJson<{ price: number }>(SPOT_URL, 25_000, TTL.spot);
  return Number(data.price);
}

/** แท่งเทียน 15 นาทีของ PAXG — ยังไม่ปรับฐาน */
export async function fetchPaxg15m(): Promise<Bar[]> {
  const rows = await getJson<unknown[][]>(PAXG_URL, 25_000, TTL.bars);
  return rows.map((row) => ({
    ts: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
  }));
}

interface YahooChart {
  chart: {
    result: {
      timestamp: number[];
      indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] };
      meta?: { regularMarketPrice?: number };
    }[];
  };
}

/**
 * แท่งเทียนทองล่วงหน้า COMEX
 * ขอบเขตที่ Yahoo ให้ (ทดสอบแล้ว): 1m=7วัน · 5m=60วัน · 15m=60วัน · 1h=2ปี
 */
export async function fetchGcf(interval = "15m", range = "60d"): Promise<Bar[]> {
  const data = await getJson<YahooChart>(`${GCF_URL}?interval=${interval}&range=${range}`, 40_000, TTL.history);
  const result = data.chart.result[0];
  const q = result.indicators.quote[0];

  const bars: Bar[] = [];
  result.timestamp.forEach((ts, i) => {
    const h = q.high[i], l = q.low[i], c = q.close[i], o = q.open[i];
    if (h === null || l === null || c === null) return;
    bars.push({ ts, o: o ?? c, h, l, c });
  });
  return bars.sort((a, b) => a.ts - b.ts);
}

export interface PriceData {
  /** ราคาปัจจุบันในสเกลโบรกเกอร์ */
  price: number;
  spot: number | null;
  basis: number;
  brokerOffset: number;
  /** แท่ง 15 นาที ปรับเป็นสเกลโบรกเกอร์แล้ว (ใช้หาแนวรับแนวต้าน + วาดกราฟ) */
  bars: Bar[];
  /** แท่ง 15 นาที 60 วันของ GC=F (ใช้ทำโปรไฟล์ความผันผวนรายชั่วโมง) */
  profileBars: Bar[];
  fetchedAt: number;
  errors: string[];
}

export async function loadPrice(brokerOffset = 0): Promise<PriceData | null> {
  const errors: string[] = [];

  const [spotRes, paxgRes, profileRes] = await Promise.allSettled([
    fetchSpot(),
    fetchPaxg15m(),
    fetchGcf("15m", "60d"),
  ]);

  const spot = spotRes.status === "fulfilled" ? spotRes.value : null;
  if (spotRes.status === "rejected") errors.push(`ราคา spot: ${spotRes.reason}`);

  if (paxgRes.status === "rejected") {
    errors.push(`PAXG 15 นาที: ${paxgRes.reason}`);
    return null;
  }
  const rawBars = paxgRes.value;
  if (!rawBars.length) return null;

  const profileBars = profileRes.status === "fulfilled" ? profileRes.value : [];
  if (profileRes.status === "rejected") errors.push(`GC=F 60 วัน: ${profileRes.reason}`);

  // ปรับ PAXG -> spot -> สเกลโบรกเกอร์
  const basis = spot ? spot - rawBars[rawBars.length - 1].c : 0;
  const shift = basis + brokerOffset;

  // ตัดแท่งเสาร์อาทิตย์ทิ้ง — PAXG ซื้อขาย 24/7 แต่ตลาดทองจริงปิด สภาพคล่องบางมาก
  const bars = rawBars
    .filter((b) => isMarketOpen(b.ts))
    .map((b) => ({ ts: b.ts, o: b.o + shift, h: b.h + shift, l: b.l + shift, c: b.c + shift }));

  if (!bars.length) return null;

  return {
    price: Math.round(bars[bars.length - 1].c * 100) / 100,
    spot: spot ? Math.round(spot * 100) / 100 : null,
    basis: Math.round(basis * 100) / 100,
    brokerOffset,
    bars,
    profileBars,
    fetchedAt: Math.floor(Date.now() / 1000),
    errors,
  };
}
