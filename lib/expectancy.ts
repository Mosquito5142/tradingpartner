/**
 * คุ้มไหมหลังหักต้นทุน — คำถามที่ "% ความแม่น" ตอบไม่ได้
 *
 * Reaction Lab บอกว่ากฎทิศทางถูก 71% ใน 15 นาที ซึ่งฟังดูดีมาก
 * แต่ % ความแม่นไม่ได้แปลว่ากินได้ เพราะยังไม่รู้ว่า:
 *   - ไม้ที่ถูกได้เท่าไหร่ เทียบกับไม้ที่ผิดเสียเท่าไหร่
 *   - สเปรดกับ slippage กินไปเท่าไหร่
 *   - ตัวเลขที่เห็นห่างจาก "บังเอิญ" แค่ไหน
 *
 * ไฟล์นี้ตอบสามข้อนั้นจากข้อมูลที่วัดจริง โดยยึดกฎเดิมของโปรเจกต์:
 * ตัวอย่างน้อยกว่า MIN_SAMPLE ห้ามสรุป และต้องโชว์ n ทุกครั้ง
 *
 * *** เป็นสถิติย้อนหลัง ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน ***
 */

import { median, MIN_SAMPLE } from "./reactions";
import type { ReactionRecord } from "./types";

/** ช่วงเวลาที่มีข้อมูลระยะวิ่งสุดขีดให้ใช้ (ต้องตรงกับ EXCURSION_HORIZONS) */
export type ExcursionHorizon = 15 | 60;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ผลลัพธ์ต่อออนซ์ของแต่ละไม้ ถ้าเข้าตามทิศที่ทฤษฎีชี้แล้วออกตามเวลา
 *
 * บวก = ทฤษฎีถูก · ลบ = ทฤษฎีผิด — ข้ามแถวที่ทฤษฎีไม่ชี้ทิศ (ข่าวแถลง/ออกตรงคาด)
 * เพราะไม้พวกนั้นไม่มีอะไรให้เข้าตั้งแต่แรก
 */
export function signedOutcomes(records: ReactionRecord[], horizon: number): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.pred !== "up" && r.pred !== "down") continue;
    const move = r[`m${horizon}` as keyof ReactionRecord] as number | null;
    if (move === null || move === undefined) continue;
    out.push(r.pred === "up" ? move : -move);
  }
  return out;
}

export interface Expectancy {
  n: number;
  /** พอที่จะแสดง % ไหม */
  enough: boolean;
  /** กำไรเฉลี่ยต่อไม้หลังหักต้นทุนแล้ว (ดอลลาร์ต่อออนซ์) */
  mean: number;
  /** ต้องดูคู่กับ mean เสมอ — ถ้าห่างกันมากแปลว่ากำไรมาจากไม้ไม่กี่ไม้ */
  median: number;
  sd: number;
  /** ขอบล่าง/ขอบบนของช่วงความเชื่อมั่น 95% ของค่าเฉลี่ย */
  ci: [number, number];
  winRate: number;
  /** ค่า t ของ "ค่าเฉลี่ยต่างจากศูนย์" — เกิน 2 ถึงเรียกว่ามีนัย */
  tStat: number;
  /** ต้นทุนสูงสุดที่ยังเท่าทุน (= กำไรเฉลี่ยก่อนหักต้นทุน) */
  breakEvenCost: number;
  /** ขอบล่างของ CI ยังบวกไหม — เกณฑ์เดียวที่ควรใช้บอกว่า "กินได้" */
  positive: boolean;
}

/**
 * สรุปว่ากินได้ไหมที่ต้นทุนระดับหนึ่ง
 *
 * ต้นทุนหักตรง ๆ ต่อไม้เพราะสเปรดจ่ายตอนเข้า/ออกไม่ขึ้นกับว่าไม้นั้นถูกหรือผิด
 * (ค่าเฉลี่ยจึงเลื่อนลงเท่ากับต้นทุนพอดี ส่วนการกระจายไม่เปลี่ยน)
 */
export function expectancy(values: number[], cost = 0): Expectancy {
  const n = values.length;
  if (!n) {
    return {
      n: 0, enough: false, mean: 0, median: 0, sd: 0, ci: [0, 0],
      winRate: 0, tStat: 0, breakEvenCost: 0, positive: false,
    };
  }

  const net = values.map((v) => v - cost);
  const mean = net.reduce((s, v) => s + v, 0) / n;
  const raw = values.reduce((s, v) => s + v, 0) / n;
  // n=1 หาความแปรปรวนไม่ได้ ให้เป็น 0 แล้วปล่อยให้ enough=false คุมการแสดงผล
  const sd = n > 1 ? Math.sqrt(net.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) : 0;
  const half = 1.96 * se;

  return {
    n,
    enough: n >= MIN_SAMPLE,
    mean: round2(mean),
    median: round2(median(net) ?? 0),
    sd: round2(sd),
    ci: [round2(mean - half), round2(mean + half)],
    winRate: Math.round((net.filter((v) => v > 0).length / n) * 100),
    tStat: se > 0 ? Math.round((mean / se) * 100) / 100 : 0,
    breakEvenCost: round2(raw),
    positive: n >= MIN_SAMPLE && se > 0 && mean - half > 0,
  };
}

/** ระยะที่ราคาสวนทางไปไกลสุดก่อนจะไปถูกทาง (MAE) ของแต่ละไม้ */
export function adverseExcursions(records: ReactionRecord[], horizon: ExcursionHorizon): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.pred !== "up" && r.pred !== "down") continue;
    // ซื้อแล้วราคาลง = สวนทาง · ขายแล้วราคาขึ้น = สวนทาง
    const mae = r.pred === "up" ? r[`dn${horizon}`] : r[`up${horizon}`];
    if (mae !== null && mae !== undefined) out.push(mae);
  }
  return out;
}

/** ระยะที่ราคาไปถูกทางไกลสุด (MFE) ของแต่ละไม้ */
export function favorableExcursions(records: ReactionRecord[], horizon: ExcursionHorizon): number[] {
  const out: number[] = [];
  for (const r of records) {
    if (r.pred !== "up" && r.pred !== "down") continue;
    const mfe = r.pred === "up" ? r[`up${horizon}`] : r[`dn${horizon}`];
    if (mfe !== null && mfe !== undefined) out.push(mfe);
  }
  return out;
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

export interface StopOutRow {
  /** ระยะ SL เป็นดอลลาร์ทอง */
  distance: number;
  /** กี่ % ของไม้ที่ราคาสวนไปถึงระยะนี้ */
  hitPct: number;
  n: number;
}

/**
 * SL แต่ละระยะจะโดนเขี่ยทิ้งกี่ %
 *
 * นับแบบ >= เพราะราคาที่แตะระยะ SL พอดีถือว่าโดนชนแล้ว
 * และไม่ได้คิด slippage ตอนโดนชน ซึ่งช่วงข่าวจะทำให้แย่กว่านี้อีก
 */
export function stopOutRates(
  records: ReactionRecord[],
  horizon: ExcursionHorizon,
  distances: number[],
): StopOutRow[] {
  const maes = adverseExcursions(records, horizon);
  if (!maes.length) return [];
  return distances.map((distance) => ({
    distance,
    hitPct: Math.round((maes.filter((m) => m >= distance).length / maes.length) * 100),
    n: maes.length,
  }));
}

export interface SegmentExpectancy {
  label: string;
  /** ผลลัพธ์ดิบต่อไม้ก่อนหักต้นทุน แยกตาม horizon — ส่งให้ client คำนวณซ้ำเองได้ */
  outcomes: Record<number, number[]>;
  /** MAE ที่ 15 นาที ใช้ทำตารางระยะ SL */
  maes: number[];
  mfeP50: number | null;
  mfeP80: number | null;
}

/** กลุ่มข่าว เรียงให้ข่าวใหญ่สหรัฐฯ มาก่อนเพราะเป็นกลุ่มเดียวที่มีขอบได้เปรียบ */
export const SEGMENTS: [string, (r: ReactionRecord) => boolean][] = [
  ["ข่าวใหญ่สหรัฐฯ", (r) => r.country === "US" && r.importance === 1],
  ["ข่าวกลางสหรัฐฯ", (r) => r.country === "US" && r.importance === 0],
  ["ยุโรป / จีน", (r) => r.country !== "US"],
];

export const HORIZONS_SHOWN = [5, 10, 15, 30, 60] as const;

/** เตรียมข้อมูลทั้งหมดให้ฝั่ง client คำนวณซ้ำได้เองเวลาปรับต้นทุน */
export function expectancyData(records: ReactionRecord[]): SegmentExpectancy[] {
  return SEGMENTS.map(([label, test]) => {
    const subset = records.filter(test);
    const outcomes: Record<number, number[]> = {};
    for (const h of HORIZONS_SHOWN) outcomes[h] = signedOutcomes(subset, h);
    const mfes = favorableExcursions(subset, 15);
    return {
      label,
      outcomes,
      maes: adverseExcursions(subset, 15),
      mfeP50: percentile(mfes, 0.5),
      mfeP80: percentile(mfes, 0.8),
    };
  }).filter((s) => s.outcomes[15].length > 0);
}
