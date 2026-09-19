/**
 * Reaction Lab — วัดว่าทอง "ตอบสนองจริง" ต่อข่าวแต่ละตัวยังไง แล้วเก็บสะสมถาวร
 *
 * bias.ts บอกทิศทางจากทฤษฎีมหภาค แต่ไม่เคยถูกตรวจสอบกับราคาจริง
 * เมื่อวัดจริงพบว่า (ข่าวใหญ่สหรัฐฯ n=35):
 *   5 นาที 66% · 10-15 นาที 71% · 30 นาที 51% · 60 นาที 49%
 * กฎใช้ได้ แต่มีอายุราว 15 นาที หลังจากนั้นเท่ากับเดาสุ่ม
 *
 * *** เป็นการวัดสถิติ ไม่ใช่สัญญาณซื้อขาย ***
 */

import { annotate } from "./bias";
import { ensureSchema, getDb } from "./db";
import { thShortDate } from "./time";
import { isNoise, thaiTitle } from "./translate";
import type { Bar, CalendarEvent, DecayPoint, ReactionRecord, ReactionStats, Surprise } from "./types";

/** นาทีหลังข่าวที่วัด — 5/10/15 คือช่วงที่สัญญาณยังมีชีวิต, 30/60 ไว้ดูการสลายตัว */
export const HORIZONS = [5, 10, 15, 30, 60] as const;

/** ตัวอย่างน้อยกว่านี้ไม่โชว์เปอร์เซ็นต์ เพราะ 1-2 ครั้งบอกอะไรไม่ได้ */
export const MIN_SAMPLE = 3;

/**
 * ชื่อกลุ่มของข่าว — คง MoM/YoY ไว้ (คนละตัวเลขกัน) แต่ตัด "ตัวเลขเบื้องต้น/สุดท้าย" ออก
 * เพื่อให้ Prel กับ Final ของข่าวเดียวกันนับรวมเป็นกลุ่มเดียว
 */
export function groupKey(event: Pick<CalendarEvent, "title" | "country">): string {
  const name = thaiTitle(event) || event.title || "";
  const parts = name.split("·").map((p) => p.trim());
  const keep = [parts[0], ...parts.slice(1).filter((p) => p.startsWith("เทียบ"))];
  return keep[0] ? keep.join(" · ") : event.title || "";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Measured {
  m5: number | null; m10: number | null; m15: number | null;
  m30: number | null; m60: number | null; rng60: number | null;
}

/** วัดการเคลื่อนไหวหลังข่าว เทียบกับ close ของแท่งก่อนข่าว */
export function measure(eventTs: number, bars: Bar[]): Measured | null {
  const before = bars.filter((b) => b.ts < eventTs);
  if (!before.length) return null;

  // ห่างเกิน 2 ชม. ถือว่าไม่ใช่ราคาอ้างอิงของข่าวนี้ (ตลาดปิดคั่น/ข้อมูลขาด)
  const reference = before[before.length - 1];
  if (eventTs - reference.ts > 2 * 3600) return null;

  const out: Record<string, number | null> = {};
  for (const horizon of HORIZONS) {
    const window = bars.filter((b) => b.ts >= eventTs && b.ts < eventTs + horizon * 60);
    out[`m${horizon}`] = window.length ? round2(window[window.length - 1].c - reference.c) : null;
  }

  const hour = bars.filter((b) => b.ts >= eventTs && b.ts < eventTs + 3600);
  out.rng60 = hour.length
    ? round2(Math.max(...hour.map((b) => b.h)) - Math.min(...hour.map((b) => b.l)))
    : null;

  const measured = out as unknown as Measured;
  return HORIZONS.some((h) => measured[`m${h}` as keyof Measured] !== null) ? measured : null;
}

/**
 * วัดข่าวที่ยังไม่เคยเก็บแล้วบันทึกลงคลัง
 *
 * ของเดิมจะไม่ถูกทับ (ใช้ INSERT ... ON CONFLICT DO NOTHING) เพราะเมื่อข้อมูลราคา
 * หลุดจากหน้าต่าง 60 วันของ Yahoo ไปแล้ว ค่าที่วัดครั้งแรกคือค่าที่ถูกต้องที่สุด
 * แต่ถ้าแถวเดิมยังขาด horizon ไหนอยู่ จะเติมให้
 */
export async function updateStore(events: CalendarEvent[], bars: Bar[]) {
  const db = getDb();
  if (!db) return { added: 0, measured: 0, total: 0, skipped: "ยังไม่ได้ตั้งค่า Turso" };
  await ensureSchema();

  const rows: (ReactionRecord & Measured)[] = [];
  for (const event of events) {
    const bias = annotate(event);
    // เก็บเฉพาะข่าวตัวเลขที่มี surprise ชัด — ข่าวแถลง (tone) วัดทิศทางแบบนี้ไม่ได้
    if (bias.kind !== "number") continue;
    if (bias.surprise !== "higher" && bias.surprise !== "lower") continue;
    if (isNoise(event) || event.importance < 0) continue;

    const measured = measure(event.ts, bars);
    if (!measured) continue;

    rows.push({
      id: event.id,
      ts: event.ts,
      key: groupKey(event),
      title: event.title,
      country: event.country,
      importance: event.importance,
      surprise: bias.surprise,
      pred: bias.outcome,
      ...measured,
    });
  }
  if (!rows.length) return { added: 0, measured: 0, total: await count() };

  const before = await count();

  // INSERT ก่อน (ของใหม่) แล้วค่อย UPDATE เติมช่องว่างของแถวเดิม
  const statements = rows.flatMap((r) => [
    {
      sql: `INSERT INTO reactions (id, ts, key, title, country, importance, surprise, pred, m5, m10, m15, m30, m60, rng60)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [r.id, r.ts, r.key, r.title, r.country, r.importance, r.surprise, r.pred,
             r.m5, r.m10, r.m15, r.m30, r.m60, r.rng60],
    },
    {
      sql: `UPDATE reactions SET
              m5 = COALESCE(m5, ?), m10 = COALESCE(m10, ?), m15 = COALESCE(m15, ?),
              m30 = COALESCE(m30, ?), m60 = COALESCE(m60, ?), rng60 = COALESCE(rng60, ?)
            WHERE id = ?`,
      args: [r.m5, r.m10, r.m15, r.m30, r.m60, r.rng60, r.id],
    },
  ]);

  // แบ่งเป็นก้อนกันคำสั่งยาวเกินขีดจำกัดของ libSQL
  const CHUNK = 200;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK), "write");
  }

  const after = await count();
  // "measured" = จำนวนข่าวที่วัดได้ในรอบนี้ (ส่วนใหญ่มีอยู่แล้ว)
  // ไม่รายงานว่า "เติม" กี่แถว เพราะ COALESCE ไม่บอกว่าแถวไหนเปลี่ยนจริง
  return { added: after - before, measured: rows.length, total: after };
}

async function count(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const res = await db.execute("SELECT COUNT(*) AS n FROM reactions");
  return Number(res.rows[0]?.n ?? 0);
}

function toRecord(row: Record<string, unknown>): ReactionRecord {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: String(row.id),
    ts: Number(row.ts),
    key: String(row.key),
    title: String(row.title),
    country: String(row.country),
    importance: Number(row.importance),
    surprise: String(row.surprise) as Surprise,
    pred: String(row.pred) as ReactionRecord["pred"],
    m5: num(row.m5), m10: num(row.m10), m15: num(row.m15),
    m30: num(row.m30), m60: num(row.m60), rng60: num(row.rng60),
  };
}

export async function allRecords(): Promise<ReactionRecord[]> {
  const db = getDb();
  if (!db) return [];
  try {
    await ensureSchema();
    const res = await db.execute("SELECT * FROM reactions ORDER BY ts DESC");
    return res.rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
  } catch {
    return [];
  }
}

/** ทฤษฎีทายถูกไหมที่ horizon นี้ (null = วัดไม่ได้ / ราคาไม่ขยับเลย) */
function hit(record: ReactionRecord, horizon: number): boolean | null {
  const move = record[`m${horizon}` as keyof ReactionRecord] as number | null;
  if (move === null || move === 0) return null;
  if (record.pred !== "up" && record.pred !== "down") return null;
  return move > 0 === (record.pred === "up");
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 100) / 100;
}

export function decayCurve(records: ReactionRecord[]): DecayPoint[] {
  const out: DecayPoint[] = [];
  for (const horizon of HORIZONS) {
    const hits = records.map((r) => hit(r, horizon)).filter((h): h is boolean => h !== null);
    if (!hits.length) continue;
    const moves = records
      .map((r) => r[`m${horizon}` as keyof ReactionRecord] as number | null)
      .filter((m): m is number => m !== null && m !== 0)
      .map(Math.abs);
    out.push({
      minutes: horizon,
      n: hits.length,
      accuracy: Math.round((hits.filter(Boolean).length / hits.length) * 100),
      medianMove: median(moves),
    });
  }
  return out;
}

/** สถิติของข่าวกลุ่มหนึ่ง */
export function statsFor(records: ReactionRecord[], key: string): ReactionStats {
  const rows = records.filter((r) => r.key === key);
  const ranges = rows.map((r) => r.rng60).filter((v): v is number => v !== null);
  return {
    key,
    n: rows.length,
    enough: rows.length >= MIN_SAMPLE,
    curve: decayCurve(rows),
    medianRange60: median(ranges),
    recent: [...rows]
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3)
      .map((r) => ({ date: thShortDate(r.ts), surprise: r.surprise, m15: r.m15, m60: r.m60 })),
  };
}

export interface Segment { label: string; n: number; curve: DecayPoint[] }

/**
 * แยกเส้นโค้งตามกลุ่มข่าว — ขอบได้เปรียบกระจุกอยู่ที่ข่าวใหญ่สหรัฐฯ
 *
 * สำคัญ: ต้องดู "ขยับมัธยฐาน" คู่กับ "% ถูก" เสมอ
 * ข่าว EU/CN แม่นสูงแต่ราคาขยับแค่ $3-4 ซึ่งเกือบเท่าสเปรด ความแม่นจึงกินไม่ได้จริง
 */
export function breakdown(records: ReactionRecord[]): Segment[] {
  const segments: [string, (r: ReactionRecord) => boolean][] = [
    ["ข่าวใหญ่สหรัฐฯ", (r) => r.country === "US" && r.importance === 1],
    ["ข่าวกลางสหรัฐฯ", (r) => r.country === "US" && r.importance === 0],
    ["ยุโรป / จีน", (r) => r.country !== "US"],
  ];
  return segments
    .map(([label, test]) => {
      const subset = records.filter(test);
      return { label, n: subset.length, curve: decayCurve(subset) };
    })
    .filter((s) => s.n > 0);
}

/**
 * ระยะที่ทองขยับปกติ "ช่วงข่าวใหญ่สหรัฐฯ" — ใช้เทียบว่า SL กว้างพอไหม
 *
 * ใช้เฉพาะกลุ่มข่าวใหญ่สหรัฐฯ ไม่ใช่ค่าเฉลี่ยรวม เพราะนั่นคือช่วงที่คนเข้าเทรดข่าวจริง
 * ค่ารวมทุกข่าวจะต่ำกว่าความจริงเพราะถูกข่าวเล็กที่แทบไม่ขยับดึงลง
 */
export function newsNoise(records: ReactionRecord[], minutes = 15): number | null {
  const big = records.filter((r) => r.country === "US" && r.importance === 1);
  const pick = (rows: ReactionRecord[]) =>
    rows.map((r) => r[`m${minutes}` as keyof ReactionRecord] as number | null)
      .filter((m): m is number => m !== null && m !== 0)
      .map(Math.abs);

  let moves = pick(big);
  if (moves.length < MIN_SAMPLE) moves = pick(records);
  return median(moves);
}

export interface LabSummary {
  total: number;
  oldest: number | null;
  newest: number | null;
  curve: DecayPoint[];
  breakdown: Segment[];
  groups: { key: string; n: number }[];
  noise15: number | null;
  configured: boolean;
}

export function summarize(records: ReactionRecord[], configured: boolean): LabSummary {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.key, (counts.get(r.key) || 0) + 1);
  return {
    total: records.length,
    oldest: records.length ? Math.min(...records.map((r) => r.ts)) : null,
    newest: records.length ? Math.max(...records.map((r) => r.ts)) : null,
    curve: decayCurve(records),
    breakdown: breakdown(records),
    groups: [...counts.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n),
    noise15: newsNoise(records, 15),
    configured,
  };
}
