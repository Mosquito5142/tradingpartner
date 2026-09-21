/**
 * โหมดข่าว — หน้าเดียวที่โฟกัสช่วง 30 นาทีรอบข่าวใหญ่
 *
 * ทำไมต้องแยกจากหน้าหลัก: จากการวัดจริง กฎทิศทางแม่น 71% ใน 10–15 นาทีแรก
 * แล้วตกเหลือ ~50% (เท่ากับเดาสุ่ม) ที่ 30 นาที ขอบได้เปรียบจึงมีอายุสั้นมาก
 * หน้านี้เลยตัดทุกอย่างที่ไม่เกี่ยวออก เหลือแค่ "ตอนนี้อยู่ในหน้าต่างนั้นหรือยัง"
 *
 * *** เป็นสถิติย้อนหลัง ไม่ใช่การทำนายราคาและไม่ใช่คำแนะนำการลงทุน ***
 */

import { annotate, isKeyEvent } from "./bias";
import { buildCard, EDGE_WINDOW_MIN, pickNext, type BriefingCard } from "./briefing";
import { loadCalendar } from "./calendar";
import { buildLevels } from "./levels";
import { loadPrice } from "./price";
import { allRecords } from "./reactions";
import { nowSec, thTime } from "./time";
import { isNoise, thaiTitle } from "./translate";
import type { AnnotatedEvent, Direction } from "./types";

/** ยังจ้องข่าวตัวเดิมต่ออีกกี่นาทีหลังประกาศ ก่อนจะเลื่อนไปข่าวถัดไป */
export const WATCH_AFTER_MIN = 30;

/** เหลือน้อยกว่านี้ถือว่า "ใกล้แล้ว" — เริ่มดึงข้อมูลถี่ขึ้นเพื่อรอตัวเลข actual */
export const IMMINENT_MIN = 10;

/** ช่วงเวลาที่ดึงปฏิทิน — แคบกว่าหน้าหลักมาก จะได้ cache แยกกันและดึงสดได้ถี่ */
const RANGE_BACK_DAYS = 0.1;
const RANGE_AHEAD_DAYS = 1.5;

/** cache ปฏิทินสั้นกว่าหน้าหลัก (5 นาที) เพราะต้องเห็นตัวเลข actual ให้เร็วที่สุด */
const LIVE_CALENDAR_TTL = 20;

export type LivePhase =
  /** ไม่มีข่าวใหญ่ในช่วงที่ดึงมา */
  | "none"
  /** ยังอีกนาน */
  | "waiting"
  /** ใกล้ประกาศแล้ว */
  | "imminent"
  /** อยู่ในหน้าต่างขอบได้เปรียบ 15 นาที */
  | "edge"
  /** เลย 15 นาทีไปแล้ว — ความแม่นตกเหลือระดับเดาสุ่ม */
  | "cooled";

export interface LiveEvent {
  ts: number;
  time: string;
  title: string;
  country: string;
  volatile: boolean;
}

export interface LiveState {
  now: number;
  phase: LivePhase;
  card: BriefingCard | null;
  /** วินาทีจนถึงเวลาประกาศ ติดลบ = ประกาศไปแล้ว */
  secondsTo: number | null;
  /** ราคาปิดของแท่งก่อนข่าว ใช้เป็นจุดอ้างอิงว่าขยับไปเท่าไหร่แล้ว */
  reference: number | null;
  /** ราคาปัจจุบัน ลบ reference — ค่าสดกว่าแท่ง 15 นาที */
  movedNow: number | null;
  /** ทิศทางที่ทฤษฎีบอกหลังรู้ตัวเลขจริงแล้ว */
  expected: Direction | "neutral" | "";
  /** ตอนนี้ราคาไปทางเดียวกับทฤษฎีไหม — null เมื่อยังบอกไม่ได้ */
  matchesTheory: boolean | null;
  /** client ควรดึงซ้ำทุกกี่วินาที */
  pollSec: number;
  upNext: LiveEvent[];
  /** ข่าวเล็กที่เหลือ — ไม่เข้าเกณฑ์ให้จ้อง แต่แสดงไว้จะได้ไม่เป็นหน้าว่าง */
  minor: LiveEvent[];
  calendarSource: string;
  barSource: string | null;
  errors: string[];
}

/**
 * ข่าวนี้คุ้มที่จะจ้องไหม
 *
 * สำคัญมากสำหรับหน้านี้: ตัวเลข 71% วัดจาก "ข่าวตัวเลขใหญ่ของสหรัฐฯ" ถ้าปล่อยให้หน้าไปหยิบ
 * สุนทรพจน์ของกรรมการเฟดสาขาหรือการประมูลตั๋วเงินมาขึ้นนาฬิกาใหญ่ ก็เท่ากับเอาสถิติของอย่างหนึ่ง
 * ไปแปะกับอีกอย่างหนึ่ง — ยอมให้หน้าว่างดีกว่าทำให้เข้าใจผิด
 */
export function worthWatching(i: AnnotatedEvent): boolean {
  return i.bias.volatile || i.event.importance === 1 || i.bias.key;
}

/** ข่าวที่หน้านี้ควรจ้องอยู่ */
export function pickFocus(items: AnnotatedEvent[], now: number): AnnotatedEvent | null {
  const worth = items.filter(worthWatching);

  // ข่าวที่เพิ่งประกาศไปมาก่อน — หลังประกาศคือช่วงที่หน้านี้มีประโยชน์ที่สุด
  // ถ้าใช้ pickNext เฉย ๆ พอถึงเวลาประกาศหน้าจะกระโดดไปข่าวถัดไปทันที
  const justOut = worth.filter(
    (i) => i.event.ts <= now && now - i.event.ts <= WATCH_AFTER_MIN * 60,
  );
  if (justOut.length) {
    return justOut.reduce((best, cur) =>
      cur.event.ts > best.event.ts ||
      (cur.event.ts === best.event.ts && cur.bias.rank < best.bias.rank)
        ? cur
        : best,
    );
  }
  return pickNext(worth, now);
}

export function phaseOf(secondsTo: number | null): LivePhase {
  if (secondsTo === null) return "none";
  if (secondsTo > IMMINENT_MIN * 60) return "waiting";
  if (secondsTo > 0) return "imminent";
  if (-secondsTo <= EDGE_WINDOW_MIN * 60) return "edge";
  return "cooled";
}

/** ยิ่งใกล้เวลาประกาศยิ่งต้องดึงถี่ ไกลแล้วดึงถี่ก็เปลืองเปล่า ๆ */
export function pollFor(phase: LivePhase, secondsTo: number | null): number {
  switch (phase) {
    case "imminent":
    case "edge":
      return 15;
    case "cooled":
      return 30;
    case "waiting":
      // เหลือไม่ถึงชั่วโมงเริ่มถี่ขึ้น ไม่งั้นนาทีละครั้งพอ
      return secondsTo !== null && secondsTo < 3600 ? 30 : 60;
    default:
      return 300;
  }
}

const toLiveEvents = (list: AnnotatedEvent[], limit: number): LiveEvent[] =>
  list.slice(0, limit).map((i) => ({
    ts: i.event.ts,
    time: thTime(i.event.ts),
    title: i.title,
    country: i.event.country,
    volatile: i.bias.volatile,
  }));

export async function loadLive(countries = ["US", "EU", "CN"]): Promise<LiveState> {
  const now = nowSec();

  const [calendar, price, records] = await Promise.all([
    loadCalendar(RANGE_BACK_DAYS, RANGE_AHEAD_DAYS, countries, LIVE_CALENDAR_TTL),
    loadPrice(Number(process.env.BROKER_OFFSET ?? -3.04)).catch(() => null),
    allRecords(),
  ]);

  const items: AnnotatedEvent[] = calendar.events
    .filter((e) => !isNoise(e) && (e.importance >= 0 || isKeyEvent(e)))
    .map((event) => {
      const bias = annotate(event);
      return { event, bias, title: thaiTitle(event) || bias.th || event.title };
    })
    .sort((a, b) => a.event.ts - b.event.ts || a.bias.rank - b.bias.rank);

  const levels = price ? buildLevels(price.bars, price.price) : [];
  const focus = pickFocus(items, now);
  const card = focus ? buildCard(focus, records, price?.price, levels) : null;
  const secondsTo = card ? card.ts - now : null;
  const phase = phaseOf(secondsTo);

  // จุดอ้างอิง = ราคาปิดของแท่งสุดท้ายก่อนข่าว วิธีเดียวกับที่ Reaction Lab ใช้วัดสถิติ
  // จะได้เทียบกับตัวเลขในคลังได้ตรง ๆ (ห่างเกิน 2 ชม. = ตลาดปิดคั่น ใช้อ้างอิงไม่ได้)
  let reference: number | null = null;
  if (card && price) {
    const before = price.bars.filter((b) => b.ts < card.ts);
    const last = before[before.length - 1];
    if (last && card.ts - last.ts <= 2 * 3600) reference = Math.round(last.c * 100) / 100;
  }

  const movedNow =
    reference !== null && price && secondsTo !== null && secondsTo <= 0
      ? Math.round((price.price - reference) * 100) / 100
      : null;

  // เทียบด้วย id ไม่ใช่เวลา เพราะข่าวหลายตัวประกาศพร้อมกันได้
  const upcoming = items.filter((i) => i.event.ts > now && i.event.id !== focus?.event.id);

  const expected = card?.outcome ?? "";
  const matchesTheory =
    movedNow === null || !expected || expected === "neutral"
      ? null
      : (expected === "up" && movedNow > 0) || (expected === "down" && movedNow < 0);

  return {
    now,
    phase,
    card,
    secondsTo,
    reference,
    movedNow,
    expected,
    matchesTheory,
    pollSec: pollFor(phase, secondsTo),
    upNext: toLiveEvents(upcoming.filter(worthWatching), 4),
    minor: toLiveEvents(upcoming.filter((i) => !worthWatching(i)), 5),
    calendarSource: calendar.source,
    barSource: price?.barSource ?? null,
    errors: [...calendar.errors, ...(price?.errors ?? [])],
  };
}
