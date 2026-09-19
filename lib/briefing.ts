/**
 * การ์ดสรุปก่อนข่าว — รวมทุกอย่างที่ควรรู้ก่อนข่าวใหญ่ตัวถัดไปไว้ที่เดียว
 *
 * คืนค่าเป็น object ธรรมดาที่ serialize เป็น JSON ได้ ไม่ยุ่งกับ UI
 * เพื่อให้ API route (และบอต Telegram ในอนาคต) เอาไปใช้ซ้ำได้
 */

import { statsFor } from "./reactions";
import { groupKey } from "./reactions";
import { thDateTime } from "./time";
import type { AnnotatedEvent, Level, ReactionRecord, ReactionStats } from "./types";

/** ขอบได้เปรียบของกฎทิศทางอยู่ราว 5-15 นาที หลัง 30 นาทีเท่ากับเดาสุ่ม (วัดจากข้อมูลจริง) */
export const EDGE_WINDOW_MIN = 15;

export interface BriefingCard {
  ts: number;
  when: string;
  title: string;
  titleEn: string;
  country: string;
  importance: number;
  volatile: boolean;
  kind: string;
  forecast: string;
  previous: string;
  theory: { dirIfHigher: string; why: string };
  edgeWindowMin: number;
  history: {
    key: string;
    n: number;
    enough: boolean;
    toneEvent?: boolean;
    accuracy15: number | null;
    medianMove15: number | null;
    medianRange60: number | null;
    recent: ReactionStats["recent"];
  };
  price?: number;
  levels?: { resistance: Level | null; support: Level | null };
}

/** ข่าวใหญ่ตัวถัดไปที่กระทบทองแรงที่สุด */
export function pickNext(items: AnnotatedEvent[], nowTs: number): AnnotatedEvent | null {
  const upcoming = items.filter((i) => i.event.ts >= nowTs);
  if (!upcoming.length) return null;

  const tests: ((i: AnnotatedEvent) => boolean)[] = [
    (i) => i.bias.volatile,
    (i) => i.event.country === "US" && i.event.importance === 1,
    (i) => i.event.importance === 1,
    () => true,
  ];
  for (const test of tests) {
    const shortlist = upcoming.filter(test);
    if (shortlist.length) {
      // ข่าวที่ประกาศพร้อมกันหลายตัว ให้หยิบตัวที่กระทบทองแรงที่สุด (rank ต่ำสุด)
      return shortlist.reduce((best, cur) =>
        cur.event.ts < best.event.ts ||
        (cur.event.ts === best.event.ts && cur.bias.rank < best.bias.rank)
          ? cur
          : best,
      );
    }
  }
  return null;
}

export function buildBriefing(
  items: AnnotatedEvent[],
  nowTs: number,
  records: ReactionRecord[],
  price?: number,
  levels?: Level[],
): BriefingCard | null {
  const picked = pickNext(items, nowTs);
  if (!picked) return null;

  const { event, bias, title } = picked;
  const key = groupKey(event);
  const history = statsFor(records, key);
  const at15 = history.curve.find((c) => c.minutes === EDGE_WINDOW_MIN);

  const card: BriefingCard = {
    ts: event.ts,
    when: thDateTime(event.ts),
    title,
    titleEn: event.title,
    country: event.country,
    importance: event.importance,
    volatile: bias.volatile,
    kind: bias.kind,
    forecast: event.forecast,
    previous: event.previous,
    theory: { dirIfHigher: bias.dirIfHigher, why: bias.why },
    edgeWindowMin: EDGE_WINDOW_MIN,
    history:
      bias.kind === "number"
        ? {
            key,
            n: history.n,
            enough: history.enough,
            // ตัวอย่างน้อยกว่า 3 ครั้งไม่โชว์ % เพราะบอกอะไรไม่ได้
            accuracy15: at15 && history.enough ? at15.accuracy : null,
            medianMove15: at15?.medianMove ?? null,
            medianRange60: history.medianRange60,
            recent: history.recent,
          }
        : {
            // ข่าวแถลง (FOMC/Powell/ECB) ไม่มีตัวเลขให้เทียบ วัดทิศทางแบบนี้ไม่ได้
            key, n: 0, enough: false, toneEvent: true,
            accuracy15: null, medianMove15: null, medianRange60: null, recent: [],
          },
  };

  if (price !== undefined && levels?.length) {
    const above = levels.filter((l) => l.price > price);
    const below = levels.filter((l) => l.price < price);
    card.price = price;
    card.levels = {
      resistance: above.length ? above.reduce((a, b) => (a.price <= b.price ? a : b)) : null,
      support: below.length ? below.reduce((a, b) => (a.price >= b.price ? a : b)) : null,
    };
  }

  return card;
}
