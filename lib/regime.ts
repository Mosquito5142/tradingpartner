/**
 * สภาพตลาดสำหรับแนวรับแนวต้าน — "ตอนนี้แนวน่าจะอยู่หรือน่าจะพัง"
 *
 * ที่มา: การวัดเหตุการณ์ราคาแตะแนว 458 ครั้งบน GC=F 15 นาที ย้อนหลัง 60 วัน พบว่า
 * **ตัวแนวเองไม่มีขอบได้เปรียบเลย** (เด้ง 50.2% เทียบระดับสุ่ม 49.6%)
 * แต่พอแยกตามสภาพตลาดกลับต่างกันชัด — เส้นเดิมใช้ได้หรือไม่ได้ขึ้นกับว่าราคาเข้ามาหายังไง
 *
 * ไฟล์นี้จึงคำนวณสภาพปัจจุบันด้วย "นิยามเดียวกับตอนวัด" เป๊ะ ๆ
 * ถ้านิยามเพี้ยนไปนิดเดียว ตัวเลขที่เอาไปแปะก็ไม่ใช่ตัวเลขของสภาพนั้นอีกต่อไป
 *
 * *** เป็นสถิติย้อนหลัง ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน ***
 */

import type { Bar, Level } from "./types";

/** ช่วง EMA/ATR — ต้องตรงกับสคริปต์ที่ใช้วัด */
const EMA_PERIOD = 200;
const ATR_PERIOD = 14;
/** ความเร็วเทียบเป็นกี่เท่าของ ATR ถึงเรียกว่า "วิ่งเข้าเร็ว" */
const FAST_THRESHOLD = 1.5;
/** วัดความเร็วจากราคาเมื่อกี่แท่งที่แล้ว (8 แท่ง 15 นาที = 2 ชั่วโมง) */
const SPEED_BARS = 8;
/**
 * ขยับน้อยกว่ากี่เท่าของ ATR ถึงเรียกว่า "ทรงตัว"
 * ต่ำกว่านี้คือสัญญาณรบกวน บอกทิศทางไปก็ทำให้ผู้ใช้เข้าใจผิด
 */
const FLAT_ATR = 0.1;

/**
 * ตัวเลขที่วัดได้จริง ใช้แสดงคู่กับสภาพปัจจุบันเสมอ
 * n ติดมาด้วยทุกตัวเพราะตัวเลขเปอร์เซ็นต์ลอย ๆ ไม่มีความหมาย
 */
export const MEASURED = {
  baseline: { pct: 50.2, n: 458 },
  fast: { pct: 44.2, n: 346 },
  slow: { pct: 68.8, n: 112 },
  highAtr: { pct: 43.4, n: 228 },
  lowAtr: { pct: 57.0, n: 230 },
  withTrend: { pct: 61.1, n: 95 },
} as const;

export interface RegimeFactor {
  label: string;
  /** ค่าที่วัดได้ตอนนี้ */
  value: string;
  /** สถิติของสภาพนี้จากการวัดจริง */
  stat: string;
  /** เข้าข้างการเด้งไหม — null = วัดไม่ได้ */
  favorsBounce: boolean | null;
}

export interface Regime {
  atr: number;
  atrMedian: number;
  /** ATR ตอนนี้อยู่เปอร์เซ็นไทล์ที่เท่าไหร่ของประวัติที่มี */
  atrPct: number;
  /** ประวัติที่ใช้เทียบยาวกี่วัน — ต้องบอกผู้ใช้ ไม่ใช่อ้างว่า 60 วันทุกครั้ง */
  historyDays: number;
  highVol: boolean;
  /** ราคาขยับมากี่เท่าของ ATR ใน 2 ชั่วโมงหลัง */
  speed: number;
  fast: boolean;
  ema200: number;
  aboveEma: boolean;
  /** แนวที่ราคากำลังวิ่งเข้าหา — ถ้าทรงตัวคือแนวที่ใกล้ที่สุดไม่ว่าฝั่งไหน */
  target: Level | null;
  /** ทิศทางตอนนี้ — ราคาสดเทียบ 15–30 นาทีก่อน ไม่ใช่ผลต่าง 2 ชั่วโมง */
  approach: "up" | "down" | "flat";
  /** เท่ากับ approach === "up" — เก็บไว้ให้โค้ดเดิมที่ใช้ boolean */
  approachUp: boolean;
  /** ชนแนวนี้เป็นการเด้งตามเทรนด์ EMA200 ไหม */
  withTrend: boolean;
  /** สรุปว่าสถิติเอียงไปทางไหน */
  verdict: "hold" | "break" | "mixed";
  /** ตัวเลขเด้งของปัจจัยที่แข็งแรงที่สุด (ความเร็วที่วิ่งเข้าหาแนว) */
  headlinePct: number;
  factors: RegimeFactor[];
}

/** EMA แบบเดียวกับที่ใช้ตอนวัด — seed ด้วยราคาปิดแท่งแรก */
export function ema(bars: Bar[], period = EMA_PERIOD): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let value = 0;
  bars.forEach((b, i) => {
    value = i === 0 ? b.c : b.c * k + value * (1 - k);
    out.push(value);
  });
  return out;
}

/** ATR แบบ Wilder — seed ด้วย true range ของแท่งแรก */
export function atr14(bars: Bar[], period = ATR_PERIOD): number[] {
  const out: number[] = [];
  let value = 0;
  bars.forEach((b, i) => {
    const tr =
      i === 0
        ? b.h - b.l
        : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
    value = i === 0 ? tr : (value * (period - 1) + tr) / period;
    out.push(value);
  });
  return out;
}

function percentileOf(values: number[], target: number): number {
  if (!values.length) return 50;
  const below = values.filter((v) => v <= target).length;
  return Math.round((below / values.length) * 100);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * อ่านสภาพตลาดตอนนี้
 *
 * ต้องมีแท่งพอสมควร (อย่างน้อยเท่าช่วง EMA) ไม่งั้น EMA200 ยังไม่นิ่ง
 * แล้วการบอกว่า "ตามเทรนด์" จะมั่วมากกว่าไม่บอกเลย
 *
 * @param bars       แท่งที่ใช้คำนวณตัวชี้วัด — ควรเป็นชุดเดียวกับที่ใช้วัดสถิติ (GC=F 60 วัน)
 *                   ไม่ใช่แท่งของโบรกเกอร์ที่มีแค่ไม่กี่วัน ไม่งั้นเปอร์เซ็นไทล์ ATR
 *                   จะเทียบกับหน้าต่างคนละขนาดกับตอนวัด
 * @param live       ราคาสดจากโบรกเกอร์ (สเกลเดียวกับ levels) — ใช้ตัดสินทิศทางและระยะถึงแนว
 *                   GC=F ของ Yahoo ช้า 10 นาที ถ้าใช้ตัดสินทิศ จะบอก "วิ่งขึ้น" ทั้งที่ราคาร่วงไปแล้ว
 *                   ส่วน ATR/EMA/ความเร็ว ยังใช้ GC=F เพราะเป็นชุดที่ใช้วัดสถิติ และเปลี่ยนช้าอยู่แล้ว
 */
export function readRegime(
  bars: Bar[],
  levels: Level[],
  live?: { price: number; ref: number },
): Regime | null {
  if (bars.length < EMA_PERIOD + SPEED_BARS) return null;

  const emas = ema(bars);
  const atrs = atr14(bars);
  const last = bars.length - 1;
  const price = bars[last].c;
  const currentAtr = atrs[last];
  if (!Number.isFinite(currentAtr) || currentAtr <= 0) return null;

  // ตัดช่วงอุ่นเครื่องของ ATR ทิ้งก่อนหาเปอร์เซ็นไทล์ ไม่งั้นค่าช่วงแรกจะลากค่ากลางเพี้ยน
  const settled = atrs.slice(ATR_PERIOD * 3);
  const atrMedian = median(settled.length ? settled : atrs);

  // ความเร็วดู 2 ชั่วโมงเหมือนตอนวัด — ห้ามเปลี่ยน ไม่งั้นตัวเลข 68.8%/44.2% ใช้ไม่ได้
  const before = bars[last - SPEED_BARS].c;
  const speed = Math.abs(price - before) / currentAtr;

  // แต่ "ทิศทาง" ตอนวัดใช้แท่งก่อนหน้าแท่งเดียว (prev.c เทียบกับแนว) ไม่ใช่ผลต่าง 2 ชั่วโมง
  // เวอร์ชันแรกเอาผลต่าง 2 ชม. มาใช้ จึงบอก "กำลังวิ่งขึ้น" ทั้งที่ราคาร่วงมาแล้ว 45 นาที
  // เพียงเพราะยังสูงกว่าเมื่อ 2 ชม.ก่อนนิดเดียว — ผู้ใช้เห็นว่าระบบช้ากว่าราคาจริง
  const nowP = live ? live.price : price;
  // ไม่มีราคาสด: ใช้ GC=F แทน โดยข้ามแท่งที่เพิ่งปิดเหมือน liveQuote
  // (แท่งสุดท้ายของ Yahoo ก็เป็นแท่งที่ยังไม่ปิด จึงมีปัญหาขอบแท่งแบบเดียวกัน)
  const prevP = live ? live.ref : bars[last - 2].c;
  const move = nowP - prevP;
  const approach: Regime["approach"] =
    Math.abs(move) < currentAtr * FLAT_ATR ? "flat" : move > 0 ? "up" : "down";
  const approachUp = approach === "up";

  // ทรงตัว = ยังไม่รู้จะไปทางไหน ดูแนวที่ใกล้ที่สุดทั้งสองฝั่ง
  const refPrice = nowP;
  const pool =
    approach === "flat"
      ? levels
      : levels.filter((l) => (approachUp ? l.price > refPrice : l.price < refPrice));
  const target = pool.length
    ? pool.reduce((a, b) => (Math.abs(a.price - refPrice) <= Math.abs(b.price - refPrice) ? a : b))
    : null;

  const aboveEma = price > emas[last];
  // ชนแนวต้านระหว่างขาลง หรือชนแนวรับระหว่างขาขึ้น = เด้งไปทางเดียวกับเทรนด์
  // ทรงตัวยังบอกไม่ได้ว่าจะชนแนวไหน จึงยังไม่นับว่าตามเทรนด์
  const withTrend = approach === "flat" ? false : approachUp ? !aboveEma : aboveEma;
  const fast = speed > FAST_THRESHOLD;
  const highVol = currentAtr > atrMedian;

  const historyDays = Math.max(1, Math.round((bars[last].ts - bars[0].ts) / 86400));

  const factors: RegimeFactor[] = [
    {
      label: "ความเร็วที่วิ่งเข้าหาแนว",
      value: fast
        ? `เร็ว — ขยับ ${speed.toFixed(1)} เท่าของ ATR ใน 2 ชม.`
        : `ช้า — ขยับ ${speed.toFixed(1)} เท่าของ ATR ใน 2 ชม.`,
      stat: fast
        ? `วิ่งเข้าเร็วเด้ง ${MEASURED.fast.pct}% (n=${MEASURED.fast.n})`
        : `ค่อย ๆ ไหลเข้าเด้ง ${MEASURED.slow.pct}% (n=${MEASURED.slow.n})`,
      favorsBounce: !fast,
    },
    {
      label: "ความผันผวนขณะนี้",
      value: `ATR $${round2(currentAtr)} — เปอร์เซ็นไทล์ที่ ${percentileOf(settled, currentAtr)} ของ ${historyDays} วันที่ผ่านมา`,
      stat: highVol
        ? `ผันผวนสูงเด้ง ${MEASURED.highAtr.pct}% (n=${MEASURED.highAtr.n})`
        : `ผันผวนต่ำเด้ง ${MEASURED.lowAtr.pct}% (n=${MEASURED.lowAtr.n})`,
      favorsBounce: !highVol,
    },
    {
      label: "ทิศทางเทียบเทรนด์ EMA200",
      value: `${aboveEma ? "ราคาเหนือ" : "ราคาใต้"} EMA200 ($${round2(emas[last])}) · ${
        approach === "flat" ? "ทรงตัว" : `กำลังวิ่ง${approachUp ? "ขึ้น" : "ลง"}`
      }`,
      stat: withTrend
        ? `เด้งตามเทรนด์ ${MEASURED.withTrend.pct}% (n=${MEASURED.withTrend.n})`
        : "เด้งสวนเทรนด์ไม่ต่างจากเดาสุ่มอย่างมีนัย",
      favorsBounce: withTrend ? true : null,
    },
  ];

  // ตัดสินจาก "ความเร็ว" เป็นหลัก เพราะเป็นคู่เดียวที่ทั้งสองฝั่งมีนัยคนละทิศ
  // อีกสองปัจจัยแสดงไว้ให้เห็นว่าหนุนหรือขัด แต่ไม่เอามาคูณกัน — n ไม่พอจะคูณ
  const support = factors.filter((f) => f.favorsBounce === true).length;
  const against = factors.filter((f) => f.favorsBounce === false).length;
  const verdict: Regime["verdict"] = fast
    ? support >= 2 ? "mixed" : "break"
    : against >= 2 ? "mixed" : "hold";

  return {
    atr: round2(currentAtr),
    atrMedian: round2(atrMedian),
    atrPct: percentileOf(settled, currentAtr),
    historyDays,
    highVol,
    speed: Math.round(speed * 100) / 100,
    fast,
    ema200: round2(emas[last]),
    aboveEma,
    target,
    approach,
    approachUp,
    withTrend,
    verdict,
    headlinePct: fast ? MEASURED.fast.pct : MEASURED.slow.pct,
    factors,
  };
}
