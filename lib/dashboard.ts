/** ประกอบข้อมูลทั้งหมดที่หน้าหลักต้องใช้ ไว้ที่เดียว */

import { annotate, isKeyEvent } from "./bias";
import { buildBriefing, type BriefingCard } from "./briefing";
import { loadCalendar } from "./calendar";
import { isConfigured } from "./db";
import { todayHours, topWindows, volatilityProfile } from "./hours";
import { buildLevels } from "./levels";
import { liveQuote, loadPrice, type PriceData } from "./price";
import { readRegime, type Regime } from "./regime";
import { allRecords, summarize, type LabSummary } from "./reactions";
import { nowSec } from "./time";
import { isNoise, thaiTitle } from "./translate";
import type { AnnotatedEvent, CalendarResult, HourRow, Level } from "./types";

export const CONFIG = {
  daysAhead: 14,
  daysBack: 1,
  countries: ["US", "EU", "CN"],
  minImportance: 0,
  /** ราคาที่กราฟโบรกเกอร์แสดง ลบด้วย ราคา spot — ตั้งผ่าน env ได้ */
  brokerOffset: Number(process.env.BROKER_OFFSET ?? -3.04),
};

export interface Dashboard {
  calendar: CalendarResult;
  items: AnnotatedEvent[];
  price: PriceData | null;
  levels: Level[];
  hours: HourRow[];
  windows: HourRow[];
  regime: Regime | null;
  card: BriefingCard | null;
  lab: LabSummary;
  now: number;
}

/** ข่าวสำคัญต่อทองจะถูกแสดงเสมอ แม้ต้นทางจะจัดความแรงไว้ต่ำกว่าเกณฑ์ */
function keep(event: Parameters<typeof annotate>[0], minImportance: number) {
  if (isNoise(event)) return false;
  if (event.importance >= minImportance) return true;
  return isKeyEvent(event);
}

export async function loadDashboard(): Promise<Dashboard> {
  const now = nowSec();

  const [calendar, price, records] = await Promise.all([
    loadCalendar(CONFIG.daysBack, CONFIG.daysAhead, CONFIG.countries),
    loadPrice(CONFIG.brokerOffset).catch(() => null),
    allRecords(),
  ]);

  const items: AnnotatedEvent[] = calendar.events
    .filter((e) => keep(e, CONFIG.minImportance))
    .map((event) => {
      const bias = annotate(event);
      return { event, bias, title: thaiTitle(event) || bias.th || event.title };
    })
    // เวลาเดียวกัน -> ข่าวแรงกว่าและกระทบทองมากกว่า (rank ต่ำ) ขึ้นก่อน
    .sort(
      (a, b) =>
        a.event.ts - b.event.ts ||
        b.event.importance - a.event.importance ||
        a.bias.rank - b.bias.rank ||
        a.event.title.localeCompare(b.event.title),
    );

  const levels = price ? buildLevels(price.bars, price.price) : [];
  const profile = volatilityProfile(price?.profileBars?.length ? price.profileBars : price?.bars ?? []);
  const hours = todayHours(items, profile, now);

  return {
    calendar,
    items,
    price,
    levels,
    hours,
    windows: topWindows(hours),
    // ใช้ GC=F 60 วันเป็นฐานคำนวณ เพราะเป็นชุดเดียวกับที่วัดสถิติไว้
    // แท่งโบรกเกอร์ (PAXG 1000 แท่ง ≈ 10 วัน) สั้นเกินกว่าจะเทียบเปอร์เซ็นไทล์ ATR ได้ตรง
    regime: price
      ? readRegime(
          price.profileBars.length >= 250 ? price.profileBars : price.bars,
          levels,
          liveQuote(price),
        )
      : null,
    card: buildBriefing(items, now, records, price?.price, levels),
    lab: summarize(records, isConfigured()),
    now,
  };
}
