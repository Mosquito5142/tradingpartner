/**
 * รูปแบบพฤติกรรมการเทรด — วัด "คนเทรด" ไม่ใช่ "ตลาด"
 *
 * ต่างจากสถิติผลงาน (อัตราชนะ, กำไรสุทธิ) ตรงที่ตัวเลขในไฟล์นี้เป็น **คำบรรยายสิ่งที่ทำไปแล้ว**
 * ไม่ใช่การประมาณค่าขอบได้เปรียบ จึงอ่านได้ตั้งแต่ไม้ไม่กี่ไม้
 * ขณะที่ "Sell ชนะ 80%" ต้องรอ n เยอะกว่านี้มากถึงจะเชื่อได้
 *
 * *** เป็นการสรุปสถิติย้อนหลัง ไม่ใช่คำแนะนำการลงทุน ***
 */

import type { Trade } from "./trades";

/** 1 ล็อต XAUUSD = 100 ออนซ์ — ตรงกับ CONTRACT ใน lib/trades.ts */
const CONTRACT = 100;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(m * 10) / 10;
}

const net = (t: Trade) => t.profit + t.commission + t.swap;

export interface Reentry {
  afterLoss: number[];
  afterWin: number[];
  medianAfterLoss: number | null;
  medianAfterWin: number | null;
  /** เข้าใหม่หลังแพ้ เร็วกว่าหลังชนะกี่เท่า — null เมื่อข้อมูลไม่พอ */
  ratio: number | null;
}

/**
 * เว้นนานแค่ไหนก่อนเปิดไม้ถัดไป แยกตามว่าไม้ก่อนหน้าแพ้หรือชนะ
 *
 * เทียบกับไม้ที่ "ปิดล่าสุดก่อนไม้นี้เปิด" ไม่ใช่ไม้ก่อนหน้าตามลำดับการเปิด
 * และข้ามไม้ที่เปิดขณะยังมีไม้อื่นค้างอยู่ เพราะนั่นคือการซ้อนไม้ ไม่ใช่การเข้าใหม่
 */
export function reentryGaps(trades: Trade[]): Reentry {
  const byOpen = [...trades].sort((a, b) => a.openTs - b.openTs);
  const afterLoss: number[] = [];
  const afterWin: number[] = [];

  const counted = new Set<number>();
  for (const t of byOpen) {
    const stillOpen = byOpen.some(
      (o) => o !== t && o.openTs < t.openTs && (o.closeTs === null || o.closeTs > t.openTs),
    );
    if (stillOpen) continue;
    // ไม้ที่เปิดพร้อมกันคือการตัดสินใจครั้งเดียว นับช่องว่างครั้งเดียว
    // ไม่งั้นจังหวะที่เปิดคู่จะถ่วงมัธยฐานเป็นสองเท่าของจังหวะที่เปิดไม้เดียว
    if (counted.has(t.openTs)) continue;
    counted.add(t.openTs);

    const closedBefore = byOpen.filter((o) => o.closeTs !== null && o.closeTs <= t.openTs);
    if (!closedBefore.length) continue;
    const prev = closedBefore.reduce((a, b) => ((a.closeTs ?? 0) >= (b.closeTs ?? 0) ? a : b));

    const gap = Math.round((t.openTs - (prev.closeTs as number)) / 60);
    (net(prev) < 0 ? afterLoss : afterWin).push(gap);
  }

  const medianAfterLoss = median(afterLoss);
  const medianAfterWin = median(afterWin);
  return {
    afterLoss,
    afterWin,
    medianAfterLoss,
    medianAfterWin,
    ratio:
      medianAfterLoss !== null && medianAfterWin !== null && medianAfterLoss > 0
        ? Math.round((medianAfterWin / medianAfterLoss) * 10) / 10
        : null,
  };
}

export interface HoldSplit {
  winMedian: number | null;
  lossMedian: number | null;
  /** ตัดกำไรเร็วกว่าที่ทนขาดทุนไหม */
  cutsWinnersEarly: boolean;
}

/** ถือไม้กำไรกับไม้ขาดทุนนานต่างกันไหม — ใช้มัธยฐานเพราะไม้ที่ถือข้ามคืนลากค่าเฉลี่ยจนไร้ความหมาย */
export function holdSplit(trades: Trade[]): HoldSplit {
  const closed = trades.filter((t) => t.holdMin !== null);
  const winMedian = median(closed.filter((t) => net(t) > 0).map((t) => t.holdMin as number));
  const lossMedian = median(closed.filter((t) => net(t) < 0).map((t) => t.holdMin as number));
  return {
    winMedian,
    lossMedian,
    cutsWinnersEarly: winMedian !== null && lossMedian !== null && winMedian < lossMedian,
  };
}

export interface Overlap {
  /** จังหวะที่มีไม้ทางเดียวกันเปิดค้างอยู่หลายไม้พร้อมกัน */
  moments: { ts: number; side: "buy" | "sell"; lots: number; count: number }[];
  /** ล็อตรวมสูงสุดที่เคยถือทางเดียวกันพร้อมกัน */
  peakLots: number;
  /** กี่ไม้ที่เปิดขณะยังมีไม้ทางเดียวกันค้างอยู่ */
  stacked: number;
  total: number;
}

/**
 * ถือหลายไม้ทางเดียวกันพร้อมกันแค่ไหน
 *
 * สำคัญเพราะขนาดไม้ที่เห็นในรายงานคือ "ต่อไม้" ไม่ใช่ความเสี่ยงจริง —
 * เปิด 0.4 สองไม้พร้อมกันคือถือ 0.8 ล็อตในไอเดียเดียว แต่รายงานยังโชว์ 0.4
 */
export function overlaps(trades: Trade[]): Overlap {
  const moments: Overlap["moments"] = [];
  let peakLots = 0;
  let stacked = 0;

  for (const side of ["buy", "sell"] as const) {
    const group = trades.filter((t) => t.side === side);
    for (const t of group) {
      const concurrent = group.filter(
        (o) => o.openTs <= t.openTs && (o.closeTs === null || o.closeTs > t.openTs),
      );
      const lots = Math.round(concurrent.reduce((s, o) => s + o.lots, 0) * 100) / 100;
      if (concurrent.length > 1) {
        stacked++;
        // เก็บจังหวะละครั้ง — ไม้ที่เปิดพร้อมกันจะให้ชุด concurrent เดียวกัน
        if (!moments.some((m) => m.ts === t.openTs && m.side === side)) {
          moments.push({ ts: t.openTs, side, lots, count: concurrent.length });
        }
      }
      if (lots > peakLots) peakLots = lots;
    }
  }

  return {
    moments: moments.sort((a, b) => a.ts - b.ts),
    peakLots,
    // ไม้แรกของแต่ละจังหวะไม่นับว่า "ซ้อน" — นับเฉพาะไม้ที่มาทับของเดิม
    stacked: Math.max(0, stacked - moments.length),
    total: trades.length,
  };
}

export interface Concentration {
  net: number;
  /** กำไรสุทธิเมื่อตัดไม้ที่กำไรสูงสุด k ไม้ออก */
  without: { k: number; net: number }[];
  /** ต้องตัดกี่ไม้ถึงจะพลิกเป็นขาดทุน — null = ตัด 3 ไม้แล้วยังบวกอยู่ */
  flipsAt: number | null;
}

/** กำไรกระจุกอยู่ที่ไม้ไม่กี่ไม้แค่ไหน */
export function concentration(trades: Trade[]): Concentration {
  const values = trades.map(net).sort((a, b) => b - a);
  const total = values.reduce((s, v) => s + v, 0);
  const round = (n: number) => Math.round(n * 100) / 100;

  const without: Concentration["without"] = [];
  let flipsAt: number | null = null;
  let running = total;
  for (let k = 1; k <= Math.min(3, values.length); k++) {
    running -= values[k - 1];
    without.push({ k, net: round(running) });
    if (flipsAt === null && running < 0) flipsAt = k;
  }
  return { net: round(total), without, flipsAt };
}

export interface Behaviour {
  n: number;
  reentry: Reentry;
  hold: HoldSplit;
  overlap: Overlap;
  concentration: Concentration;
  withSl: number;
  withTp: number;
  /** ไม้ที่ขาดทุนหนักสุด (หน่วยเดียวกับบัญชี) */
  worstLoss: number;
  /** ถ้าถือขนาดสูงสุดที่เคยถือ แล้วราคาสวน $20 จะเสียเท่าไหร่ */
  shockLoss: number;
}

/** ระยะที่ใช้ทดสอบว่า "ถ้าราคาสวนแรง" จะเสียเท่าไหร่ — $20 คือเปอร์เซ็นไทล์ 90 ของช่วงข่าวที่วัดได้ */
export const SHOCK_MOVE = 20;

export function analyseBehaviour(trades: Trade[]): Behaviour | null {
  if (!trades.length) return null;
  const overlap = overlaps(trades);
  return {
    n: trades.length,
    reentry: reentryGaps(trades),
    hold: holdSplit(trades),
    overlap,
    concentration: concentration(trades),
    withSl: trades.filter((t) => t.sl !== null && t.sl > 0).length,
    withTp: trades.filter((t) => t.tp !== null && t.tp > 0).length,
    worstLoss: Math.round(Math.min(...trades.map(net)) * 100) / 100,
    shockLoss: Math.round(SHOCK_MOVE * overlap.peakLots * CONTRACT * 100) / 100,
  };
}
