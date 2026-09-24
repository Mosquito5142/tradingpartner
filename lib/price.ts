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
/**
 * ตัดแท่งที่ timestamp ซ้ำ เก็บตัวที่มาทีหลัง
 *
 * Yahoo ส่งแท่งที่ยังไม่ปิดมาซ้ำ timestamp เดียวกับแท่งล่าสุด (เจอจริง: 14:45 สองครั้ง)
 * ถ้าไม่ตัด การนับย้อน "8 แท่ง = 2 ชั่วโมง" จะเหลือ 7 แท่งจริง
 * และการเทียบแท่งล่าสุดกับแท่งก่อนหน้าจะกลายเป็นเทียบแท่งเดียวกับตัวเอง
 * เก็บตัวหลังเพราะเป็นข้อมูลที่ใหม่กว่า
 */
export function dedupeBars(bars: Bar[]): Bar[] {
  const byTs = new Map<number, Bar>();
  for (const b of bars) byTs.set(b.ts, b);
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

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
  return dedupeBars(bars);
}

/**
 * ราคาสดกับราคาอ้างอิงเมื่อ 15–30 นาทีก่อน ในสเกลโบรกเกอร์ — ใช้ตัดสินทิศทางตอนนี้
 *
 * แท่งสุดท้ายคือแท่งที่ยังไม่ปิด (ราคาสด) จึงข้ามแท่งที่เพิ่งปิดไปใช้แท่งก่อนหน้านั้นอีกแท่ง
 * ถ้าใช้แท่งที่เพิ่งปิด ช่วงต้นแท่งใหม่ราคายังไม่ทันขยับ ผลต่างจะเป็นศูนย์ แล้วบอก "ทรงตัว"
 * ทั้งที่ราคากำลังร่วง — และ cron ยิงตรง :00 :15 :30 :45 พอดี จะเจอกรณีนี้แทบทุกรอบ
 *
 * ใช้ร่วมกันทั้งหน้าหลักและ cron จะได้ไม่คำนวณคนละแบบ
 */
export function liveQuote(p: PriceData): { price: number; ref: number } | undefined {
  if (p.bars.length < 3) return undefined;
  return { price: p.price, ref: p.bars[p.bars.length - 3].c };
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
  /** แท่งเทียนมาจากไหน — PAXG ใกล้ spot กว่า แต่ Binance บล็อก IP สหรัฐฯ */
  barSource: "PAXG" | "GC=F";
  /** ปรับฐานด้วยราคา spot จริงได้ไหม — ถ้าไม่ได้ ระดับราคาจะเชื่อถือไม่ได้ */
  calibrated: boolean;
  fetchedAt: number;
  errors: string[];
}

/**
 * โหลดราคา — ออกแบบให้ไม่ผูกกับแหล่งเดียว
 *
 * PAXG (Binance) ให้ค่าใกล้ spot ที่สุด (ห่าง ~$5) แต่ **Binance บล็อก IP สหรัฐฯ (HTTP 451)**
 * ซึ่ง Vercel รัน function ที่ภูมิภาค US เป็นค่าเริ่มต้น — เวอร์ชันแรกจึงใช้ได้แค่บนเครื่อง
 * ที่ IP ไทย พอขึ้นเซิร์ฟเวอร์กราฟหายทั้งหน้า
 *
 * จึงสำรองด้วย GC=F ซึ่งดึงมาอยู่แล้วสำหรับโปรไฟล์รายชั่วโมง (ไม่เปลืองรีเควสต์เพิ่ม)
 * ห่าง spot ~$35 แต่ปรับฐานด้วย spot จริงได้เหมือนกัน
 */
export async function loadPrice(brokerOffset = 0): Promise<PriceData | null> {
  const errors: string[] = [];

  const [spotRes, paxgRes, gcfRes] = await Promise.allSettled([
    fetchSpot(),
    fetchPaxg15m(),
    fetchGcf("15m", "60d"),
  ]);

  const spot = spotRes.status === "fulfilled" ? spotRes.value : null;
  if (spotRes.status === "rejected") errors.push(`ราคา spot: ${spotRes.reason}`);

  const gcfBars = gcfRes.status === "fulfilled" ? gcfRes.value : [];
  if (gcfRes.status === "rejected") errors.push(`GC=F: ${gcfRes.reason}`);

  const paxgBars = paxgRes.status === "fulfilled" ? paxgRes.value : [];
  if (paxgRes.status === "rejected") errors.push(`PAXG (Binance): ${paxgRes.reason}`);

  // เลือกแหล่งแท่งเทียน: PAXG ก่อนเพราะใกล้ spot กว่า ไม่ได้ค่อยใช้ GC=F
  const [rawBars, barSource]: [Bar[], PriceData["barSource"]] =
    paxgBars.length ? [paxgBars, "PAXG"] : [gcfBars, "GC=F"];

  if (!rawBars.length) {
    // ล้มทั้งสองแหล่ง — log ไว้ให้เห็นใน runtime log ของ Vercel ไม่งั้นจะ debug ไม่ได้เลย
    console.error("[price] ดึงแท่งเทียนไม่ได้ทั้ง PAXG และ GC=F:", errors.join(" | "));
    return null;
  }

  // ปรับแหล่งที่เลือก -> spot -> สเกลโบรกเกอร์
  const basis = spot ? spot - rawBars[rawBars.length - 1].c : 0;
  const shift = basis + brokerOffset;

  // PAXG ซื้อขาย 24/7 แท่งเสาร์อาทิตย์สภาพคล่องบางมากต้องตัดทิ้ง
  // (GC=F ไม่มีแท่งช่วงนั้นอยู่แล้ว กรองซ้ำก็ไม่เสียหาย)
  const bars = rawBars
    .filter((b) => isMarketOpen(b.ts))
    .map((b) => ({ ts: b.ts, o: b.o + shift, h: b.h + shift, l: b.l + shift, c: b.c + shift }));

  if (!bars.length) {
    console.error("[price] ไม่เหลือแท่งเทียนหลังกรองเวลาตลาด");
    return null;
  }

  if (errors.length) console.warn("[price] บางแหล่งใช้ไม่ได้:", errors.join(" | "));

  return {
    price: Math.round(bars[bars.length - 1].c * 100) / 100,
    spot: spot ? Math.round(spot * 100) / 100 : null,
    basis: Math.round(basis * 100) / 100,
    brokerOffset,
    bars,
    profileBars: gcfBars,
    barSource,
    calibrated: spot !== null,
    fetchedAt: Math.floor(Date.now() / 1000),
    errors,
  };
}
