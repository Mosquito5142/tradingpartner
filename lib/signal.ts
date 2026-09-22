/**
 * แจ้งเตือนสภาพตลาดรอบแนวรับแนวต้าน
 *
 * ตั้งใจไม่ทำเป็น "สัญญาณซื้อขาย" เพราะผลการวัดไม่รองรับ:
 * สภาพที่เข้าเกณฑ์ให้กำไรเฉลี่ย +$2.22/ไม้ แต่ช่วงความเชื่อมั่นคร่อมศูนย์ (−0.30 ถึง +4.73)
 * ส่วนสภาพตรงข้าม (วิ่งเข้าเร็ว) ขาดทุน −$2.60/ไม้ อย่างมีนัย (n=335, t=−4.17)
 *
 * ข้อความจึงรายงาน "สภาพตอนนี้ + สถิติพร้อมความไม่แน่นอน + เลขคณิตตามสูตรของผู้ใช้"
 * ไม่ใช่ "ให้ซื้อเท่านี้" — ตัดสินใจเป็นของผู้ใช้
 *
 * *** เป็นสถิติย้อนหลัง ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน ***
 */

import type { Regime } from "./regime";

/**
 * ผลจำลองเทรดเด้งที่แนว — GC=F 15 นาที 60 วัน
 * เข้าที่ระดับแนว ทิศทางเด้ง (ชนแนวต้าน=ขาย ชนแนวรับ=ซื้อ) มองไป 16 แท่ง
 * ตัวเลขทั้งหมดผูกกับ SL/TP ชุดนี้ ถ้าเปลี่ยน SL/TP ตัวเลขใช้ไม่ได้แล้ว
 */
export const SIM = { sl: 10, tp: 15, cost: 0.5 } as const;

export const MEASURED = {
  slowCalm: { n: 90, mean: 2.22, lo: -0.3, hi: 4.73, win: 51, bounce: 68.8 },
  slow: { n: 121, mean: 1.57, lo: -0.6, hi: 3.75, win: 49 },
  fast: { n: 335, mean: -2.6, lo: -3.82, hi: -1.38, win: 33, bounce: 44.2 },
  all: { n: 456, mean: -1.49, lo: -2.57, hi: -0.41, win: 37, bounce: 50.2 },
  /** ระดับราคาสุ่มในสภาพตลาดเดียวกัน — ช่วงทับกับแนวจริง จึงยังแยกกันไม่ออก */
  control: { n: 90, mean: -0.71, lo: -3.17, hi: 1.75 },
} as const;

/**
 * สูตรขนาดไม้ของผู้ใช้ (กำหนดเอง ไม่ใช่ข้อเสนอของระบบ)
 * แบ่งชั้นตามยอดเงินเป็นเงินบาท
 */
export const LOT_TIERS: { upTo: number; lots: string; value: number }[] = [
  { upTo: 1000, lots: "0.5", value: 0.5 },
  { upTo: 3000, lots: "1–1.5", value: 1.5 },
  { upTo: Infinity, lots: "2", value: 2 },
];

export function lotForBalance(balanceThb: number) {
  return LOT_TIERS.find((t) => balanceThb <= t.upTo) ?? LOT_TIERS[LOT_TIERS.length - 1];
}

/** ราคาต้องเข้าใกล้แนวแค่ไหนถึงจะคุ้มเตือน — ไกลกว่านี้ยังไม่มีอะไรให้ดู */
export const NEAR_ATR = 0.6;

/** เตือนซ้ำเรื่องเดิมได้เร็วสุดกี่วินาที */
export const COOLDOWN_SEC = 4 * 3600;

export type SignalKind = "hold" | "break";

export interface RegimeSignal {
  kind: SignalKind;
  /** ใช้กันส่งซ้ำ — ผูกกับสภาพและระดับแนว ไม่ใช่เวลา */
  id: string;
  text: string;
}

const f2 = (n: number) => n.toFixed(2);
const money = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ประกอบข้อความ — คืน null เมื่อยังไม่มีอะไรให้เตือน
 *
 * เงื่อนไขที่ต้องครบ: มีแนวข้างหน้า · ราคาเข้าใกล้พอ · สภาพชัดเจน (ไม่ใช่ mixed)
 */
export function buildRegimeSignal(
  regime: Regime | null,
  price: number,
  balanceThb: number | null,
  thbPerUsd: number,
): RegimeSignal | null {
  if (!regime || !regime.target) return null;
  if (regime.verdict === "mixed") return null;

  const distance = Math.abs(regime.target.price - price);
  if (distance > regime.atr * NEAR_ATR) return null;

  const kind: SignalKind = regime.verdict === "hold" ? "hold" : "break";
  const stat = kind === "hold" ? MEASURED.slowCalm : MEASURED.fast;
  const isSupport = regime.target.side === "support";

  const lines: string[] = [];

  lines.push(
    kind === "hold"
      ? "🟢 <b>สภาพเข้าเงื่อนไขที่แนวมักอยู่</b> (XAUUSD)"
      : "🔴 <b>สภาพที่วัดได้ว่าแนวมักพัง</b> (XAUUSD)",
  );
  lines.push(
    "",
    `ราคา <b>${money(price)}</b> · กำลังไหล${regime.approachUp ? "ขึ้น" : "ลง"}เข้าหา` +
      `${isSupport ? "แนวรับ" : "แนวต้าน"} <b>${money(regime.target.price)}</b> ` +
      `(ห่าง $${f2(distance)})`,
    `${regime.target.label}`,
    `ความเร็ว ${f2(regime.speed)} เท่าของ ATR (${regime.fast ? "เร็ว" : "ช้า"}) · ` +
      `ATR $${f2(regime.atr)} เปอร์เซ็นไทล์ ${regime.atrPct} ของ ${regime.historyDays} วัน`,
  );

  lines.push(
    "",
    `<b>สถิติสภาพแบบนี้</b> (n=${stat.n}) — เด้ง ${stat.bounce}%`,
    `ถ้าเทรดเด้งจริงด้วย SL $${SIM.sl} / TP $${SIM.tp} หักต้นทุน $${f2(SIM.cost)}:`,
    `  เฉลี่ย <b>${stat.mean > 0 ? "+" : ""}${f2(stat.mean)}</b>/ไม้ · ชนะ ${stat.win}% · ` +
      `ช่วงเชื่อมั่น 95% ${f2(stat.lo)} ถึง ${f2(stat.hi)}`,
  );

  if (kind === "hold") {
    lines.push(
      `  <i>ช่วงยังคร่อมศูนย์ — สรุปไม่ได้ว่ากินได้จริง</i>`,
      `  <i>ระดับราคาสุ่มในสภาพเดียวกันได้ ${f2(MEASURED.control.mean)} (${f2(MEASURED.control.lo)} ถึง ${f2(MEASURED.control.hi)}) ซึ่งช่วงทับกัน</i>`,
    );
  } else {
    lines.push(
      `  <i>ฝั่งนี้มีนัยสำคัญ (t=−4.17) — เป็นข้อมูลที่แน่นที่สุดที่วัดได้</i>`,
      `  ถ้าจะเล่นเด้งที่แนวนี้ สถิติบอกว่าเสียเปรียบ`,
    );
  }

  if (balanceThb !== null) {
    const tier = lotForBalance(balanceThb);
    // 1 ล็อต XAUUSDc = 1 ออนซ์ -> ทองขยับ $1 = lots x เรตบาท
    const perDollar = tier.value * thbPerUsd;
    lines.push(
      "",
      `<b>ตามสูตรของคุณ</b> (ยอด ฿${money(balanceThb)} → ${tier.lots} ล็อต)`,
      `  ทอง $1 = ฿${money(perDollar)}`,
      `  SL $${SIM.sl} = ฿${money(SIM.sl * perDollar)} ` +
        `(${((SIM.sl * perDollar) / balanceThb * 100).toFixed(0)}% ของพอร์ต)`,
      `  TP $${SIM.tp} = ฿${money(SIM.tp * perDollar)}`,
    );
  }

  lines.push(
    "",
    "<i>เป็นการรายงานสภาพตลาดและสถิติย้อนหลัง ไม่ใช่สัญญาณซื้อขายและไม่ใช่คำแนะนำการลงทุน</i>",
  );

  return {
    kind,
    // ผูกกับระดับแนว ไม่ผูกกับเวลา — ราคาแกว่งรอบแนวเดิมจะไม่ยิงซ้ำ
    id: `regime:${kind}:${regime.target.price.toFixed(0)}`,
    text: lines.join("\n"),
  };
}
