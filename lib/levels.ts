/**
 * แนวรับ / แนวต้าน จากแท่งเทียน 15 นาที
 *
 * รวม 4 วิธีมาตรฐานที่เทรดเดอร์ใช้กันทั่วไป:
 *   1. Swing high/low แบบ fractal — จุดกลับตัวที่ราคาเคยเด้ง/ชน จับกลุ่มเป็น "โซน"
 *   2. Pivot Point รายวัน — PP/R1/R2/S1/S2 จาก High-Low-Close ของเมื่อวาน
 *   3. High/Low เมื่อวาน + กรอบเอเชีย
 *   4. เลขกลม ($25)
 *
 * *** เป็นเครื่องมือช่วยอ่านกราฟ ไม่ใช่สัญญาณซื้อขาย ***
 */

import { thParts } from "./time";
import type { Bar, Level, LevelKind } from "./types";

/** ความกว้างสูงสุดของหนึ่งโซน (สัดส่วนของราคา) — 0.08% ของ $4,300 ประมาณ $3.4 */
const ZONE_WIDTH_PCT = 0.0008;
/** กี่แท่งซ้าย/ขวาถึงจะนับเป็นจุดกลับตัว (3 แท่ง = 45 นาที) */
const SWING_LOOKBACK = 3;
const ROUND_STEP = 25;
const ASIA_START_HOUR = 6;
const ASIA_END_HOUR = 14;

interface SwingPoint { price: number; ts: number }

function swingPoints(bars: Bar[], k = SWING_LOOKBACK): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = k; i < bars.length - k; i++) {
    const window = bars.slice(i - k, i + k + 1);
    if (bars[i].h >= Math.max(...window.map((b) => b.h))) points.push({ price: bars[i].h, ts: bars[i].ts });
    if (bars[i].l <= Math.min(...window.map((b) => b.l))) points.push({ price: bars[i].l, ts: bars[i].ts });
  }
  return points;
}

/**
 * จับกลุ่มจุดที่ราคาใกล้กันเป็นโซนเดียว
 *
 * สำคัญ: เทียบกับ "ราคาเริ่มโซน" ไม่ใช่จุดก่อนหน้า — ไม่งั้นจุดจะต่อกันเป็นลูกโซ่
 * จนกลายเป็นโซนเดียวกว้างเป็นร้อยเหรียญ (บั๊กที่เคยเจอตอนต้นแบบ)
 */
function cluster(points: SwingPoint[], width: number) {
  if (!points.length) return [];
  const sorted = [...points].sort((a, b) => a.price - b.price);
  const zones: SwingPoint[][] = [];
  let current: SwingPoint[] = [sorted[0]];

  for (const point of sorted.slice(1)) {
    if (point.price - current[0].price <= width) current.push(point);
    else { zones.push(current); current = [point]; }
  }
  zones.push(current);

  return zones.map((z) => ({
    price: z.reduce((sum, p) => sum + p.price, 0) / z.length,
    touches: z.length,
    lastTs: Math.max(...z.map((p) => p.ts)),
  }));
}

const dayBars = (bars: Bar[], dateKey: string) => bars.filter((b) => thParts(b.ts).dateKey === dateKey);

/** Pivot รายวัน + High/Low เมื่อวาน + กรอบเอเชียของวันนี้ */
function referenceLevels(bars: Bar[]) {
  if (!bars.length) return [];
  const todayKey = thParts(bars[bars.length - 1].ts).dateKey;
  const earlier = bars.filter((b) => thParts(b.ts).dateKey < todayKey);
  const out: { price: number; kind: LevelKind; label: string }[] = [];

  if (earlier.length) {
    const prevKey = thParts(earlier[earlier.length - 1].ts).dateKey;
    const prev = dayBars(bars, prevKey);
    const high = Math.max(...prev.map((b) => b.h));
    const low = Math.min(...prev.map((b) => b.l));
    const close = prev[prev.length - 1].c;
    const pivot = (high + low + close) / 3;
    const span = high - low;

    out.push(
      { price: high, kind: "prev_high", label: "High เมื่อวาน" },
      { price: low, kind: "prev_low", label: "Low เมื่อวาน" },
      { price: pivot, kind: "pivot", label: "Pivot Point" },
      { price: 2 * pivot - low, kind: "pivot", label: "แนวต้าน R1" },
      { price: 2 * pivot - high, kind: "pivot", label: "แนวรับ S1" },
      { price: pivot + span, kind: "pivot", label: "แนวต้าน R2" },
      { price: pivot - span, kind: "pivot", label: "แนวรับ S2" },
    );
  }

  const asia = dayBars(bars, todayKey).filter((b) => {
    const h = thParts(b.ts).hour;
    return h >= ASIA_START_HOUR && h < ASIA_END_HOUR;
  });
  if (asia.length >= 4) {
    out.push(
      { price: Math.max(...asia.map((b) => b.h)), kind: "asia", label: "ยอดกรอบเอเชียวันนี้" },
      { price: Math.min(...asia.map((b) => b.l)), kind: "asia", label: "ก้นกรอบเอเชียวันนี้" },
    );
  }
  return out;
}

/** เลขกลมทุก $25 ในระยะที่ราคาเอื้อมถึงได้ในวันเดียว */
function roundLevels(price: number, span: number) {
  const out: { price: number; kind: LevelKind; label: string }[] = [];
  let value = Math.floor((price - span) / ROUND_STEP) * ROUND_STEP;
  while (value <= price + span) {
    if (Math.abs(value - price) > 1) {
      out.push({ price: value, kind: "round", label: `เลขกลม ${value.toLocaleString()}` });
    }
    value += ROUND_STEP;
  }
  return out;
}

/** คืนแนวรับ/แนวต้านที่ใกล้ราคาปัจจุบันที่สุด เรียงจากสูงไปต่ำ */
export function buildLevels(bars: Bar[], price: number, maxEachSide = 5): Level[] {
  if (!bars.length) return [];

  const width = price * ZONE_WIDTH_PCT;
  const newestTs = bars[bars.length - 1].ts;
  const twoDays = 2 * 24 * 3600;

  type Candidate = { price: number; kind: LevelKind; label: string; touches: number; strength: number; also?: string };
  const candidates: Candidate[] = [];

  // 1) โซนจากจุดกลับตัว — ต้องถูกแตะอย่างน้อย 2 ครั้งถึงจะนับเป็นโซนจริง
  for (const zone of cluster(swingPoints(bars), width)) {
    if (zone.touches < 2) continue;
    const recent = zone.lastTs >= newestTs - twoDays;
    candidates.push({
      price: zone.price,
      kind: "swing",
      label: `โซนกลับตัว (แตะ ${zone.touches} ครั้ง)`,
      touches: zone.touches,
      // โซนที่เพิ่งถูกแตะภายใน 2 วันมีน้ำหนักกว่าโซนเก่า
      strength: zone.touches * (recent ? 2 : 1),
    });
  }

  // 2) ระดับอ้างอิงมาตรฐาน
  for (const level of referenceLevels(bars)) {
    candidates.push({ ...level, touches: 0, strength: 3 });
  }

  // 3) เลขกลม — น้ำหนักน้อยสุด ใช้เติมช่องว่างเวลาที่ราคาหลุดกรอบ
  const recentBars = bars.slice(-96);
  const dayRange = Math.max(...recentBars.map((b) => b.h)) - Math.min(...recentBars.map((b) => b.l));
  for (const level of roundLevels(price, Math.max(dayRange, 30))) {
    candidates.push({ ...level, touches: 0, strength: 1 });
  }

  // รวมระดับที่ซ้อนกัน — เก็บตัวที่น้ำหนักสูงสุดไว้เป็นตัวแทน
  candidates.sort((a, b) => a.price - b.price);
  const merged: Candidate[] = [];
  for (const cand of candidates) {
    const last = merged[merged.length - 1];
    if (last && cand.price - last.price <= width) {
      const best = last.strength >= cand.strength ? last : cand;
      const other = best === last ? cand : last;
      merged[merged.length - 1] = {
        ...best,
        strength: best.strength + other.strength * 0.5,
        also: other.label,
      };
    } else {
      merged.push({ ...cand });
    }
  }

  const levels: Level[] = merged.map((m) => ({
    ...m,
    side: m.price > price ? "resistance" : "support",
    distance: Math.round((m.price - price) * 100) / 100,
    price: Math.round(m.price * 100) / 100,
    strength: Math.round(m.strength * 10) / 10,
  }));

  const above = levels.filter((l) => l.side === "resistance").sort((a, b) => a.price - b.price).slice(0, maxEachSide);
  const below = levels.filter((l) => l.side === "support").sort((a, b) => b.price - a.price).slice(0, maxEachSide);
  return [...above, ...below].sort((a, b) => b.price - a.price);
}
