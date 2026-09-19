/**
 * วันนี้น่าเล่นกี่โมง — รวม "ชั่วโมงที่ทองแกว่งจริงในอดีต" เข้ากับ "เวลาข่าวของวันนี้"
 *
 * โปรไฟล์ความผันผวนมาจากการวัดช่วง High-Low ของแท่ง 15 นาทีย้อนหลัง 60 วัน
 * แล้วหาค่ามัธยฐานแยกตามชั่วโมง (เวลาไทย) — ใช้มัธยฐานเพราะทนต่อวันที่มีข่าวใหญ่ผิดปกติ
 *
 * *** บอกได้แค่ว่า "ชั่วโมงไหนทองเคยแกว่งแรง" ไม่ได้บอกว่าจะแกว่งทางไหน ***
 */

import { thParts, thTime } from "./time";
import type { AnnotatedEvent, Bar, HourRow } from "./types";

/** เซสชันตลาดตามเวลาไทย (ช่วงเดือนที่ยุโรป/สหรัฐฯ ใช้เวลาฤดูร้อน) */
const SESSIONS: [number, number, string][] = [
  [5, 13, "เอเชีย"],
  [13, 20, "ลอนดอน"],
  [20, 23, "ลอนดอน + นิวยอร์ก ทับกัน"],
  [23, 28, "นิวยอร์ก"], // 28 = 04:00 ของวันถัดไป (หลังจากนั้น CME ปิดพัก)
];

export function sessionName(hour: number): string {
  for (const [start, end, name] of SESSIONS) {
    if ((hour >= start && hour < end) || (end > 24 && hour < end - 24)) return name;
  }
  return "ตลาดพัก";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** { ชั่วโมงไทย: ช่วง High-Low มัธยฐานต่อแท่ง 15 นาที } */
export function volatilityProfile(bars: Bar[]): Map<number, number> {
  const buckets = new Map<number, number[]>();
  for (const bar of bars) {
    const hour = thParts(bar.ts).hour;
    const list = buckets.get(hour) || [];
    list.push(bar.h - bar.l);
    buckets.set(hour, list);
  }
  const out = new Map<number, number>();
  for (const [hour, values] of buckets) {
    // ชั่วโมงที่เก็บตัวอย่างได้น้อยเกินไป (ช่วงตลาดพัก) ไม่น่าเชื่อถือพอ
    if (values.length >= 20) out.set(hour, median(values));
  }
  return out;
}

function eventWeight(item: AnnotatedEvent): number {
  if (item.bias.volatile) return 6;
  if (item.event.country === "US" && item.event.importance === 1) return 4;
  if (item.event.importance === 1) return 2;
  if (item.event.country === "US") return 1;
  return 0.5;
}

/** ตาราง 24 ชั่วโมงของวันนี้ พร้อมคะแนนความน่าสนใจ */
export function todayHours(
  items: AnnotatedEvent[],
  profile: Map<number, number>,
  nowTs: number,
): HourRow[] {
  const today = thParts(nowTs);
  const byHour = new Map<number, AnnotatedEvent[]>();
  for (const item of items) {
    const p = thParts(item.event.ts);
    if (p.dateKey !== today.dateKey) continue;
    const list = byHour.get(p.hour) || [];
    list.push(item);
    byHour.set(p.hour, list);
  }

  const peak = profile.size ? Math.max(...profile.values()) : 1;

  return Array.from({ length: 24 }, (_, hour) => {
    const vol = profile.get(hour) || 0;
    const list = (byHour.get(hour) || []).sort(
      (a, b) => a.event.ts - b.event.ts || a.bias.rank - b.bias.rank,
    );
    const newsWeight = list.reduce((sum, item) => sum + eventWeight(item), 0);

    return {
      hour,
      vol: Math.round(vol * 100) / 100,
      volPct: peak ? Math.round((vol / peak) * 100) : 0,
      session: sessionName(hour),
      events: list.map((item) => ({
        time: thTime(item.event.ts),
        country: item.event.country,
        importance: item.event.importance,
        volatile: item.bias.volatile,
        title: item.title,
      })),
      newsWeight,
      // ความผันผวนพื้นฐาน (เต็ม 10) + น้ำหนักข่าว — ข่าวมีผลมากกว่าเพราะเป็นตัวจุดชนวน
      score: Math.round(((peak ? (vol / peak) * 10 : 0) + newsWeight * 2) * 10) / 10,
      isNow: hour === today.hour,
      isPast: hour < today.hour,
    };
  });
}

/** ช่วงเวลาที่เหลือของวันนี้ซึ่งน่าจับตาที่สุด */
export function topWindows(rows: HourRow[], limit = 3): HourRow[] {
  return rows
    .filter((r) => !r.isPast && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
