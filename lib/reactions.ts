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
  up15: number | null; dn15: number | null;
  up60: number | null; dn60: number | null;
}

/** ช่วงเวลาที่เก็บระยะวิ่งสุดขีด — 15 คือช่วงที่มีขอบได้เปรียบ 60 ไว้ดูภาพกว้าง */
export const EXCURSION_HORIZONS = [15, 60] as const;

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

  // ราคาวิ่งขึ้น/ลงไกลสุดเท่าไหร่ เทียบราคาอ้างอิงเดียวกับข้างบน
  // ยังไม่แปลงเป็น MFE/MAE ที่นี่ เพราะทิศที่ทฤษฎีชี้อาจเปลี่ยนได้ถ้าแก้กฎใน bias.ts
  // เก็บดิบไว้แล้วตีความตอนอ่าน ข้อมูลเก่าจะได้ไม่เสียเปล่า
  for (const horizon of EXCURSION_HORIZONS) {
    const window = bars.filter((b) => b.ts >= eventTs && b.ts < eventTs + horizon * 60);
    out[`up${horizon}`] = window.length
      ? Math.max(0, round2(Math.max(...window.map((b) => b.h)) - reference.c))
      : null;
    out[`dn${horizon}`] = window.length
      ? Math.max(0, round2(reference.c - Math.min(...window.map((b) => b.l))))
      : null;
  }

  const measured = out as unknown as Measured;
  return HORIZONS.some((h) => measured[`m${h}` as keyof Measured] !== null) ? measured : null;
}

/**
 * พลาดเป้าไปกี่ % ของค่าคาดการณ์
 *
 * ใช้ค่าสัมพัทธ์เพราะข่าวคนละตัวมีหน่วยคนละแบบ (NFP เป็นแสนคน, CPI เป็นทศนิยม)
 * เทียบกันตรง ๆ ไม่ได้ แต่ก็มีข้อจำกัดที่ต้องบอกผู้ใช้: คาดการณ์ที่ใกล้ศูนย์
 * จะทำให้ % พองผิดส่วน (CPI 0.3 เทียบ 0.2 = พลาด 50%) จึงตัดทิ้งเมื่อหารไม่ได้จริง
 */
export function surpriseMagnitude(
  event: Pick<CalendarEvent, "actualRaw" | "forecastRaw">,
): number | null {
  const { actualRaw: a, forecastRaw: f } = event;
  if (typeof a !== "number" || typeof f !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(f)) return null;
  if (Math.abs(f) < 1e-9) return null;
  return Math.round((Math.abs(a - f) / Math.abs(f)) * 10000) / 100;
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
  /**
   * ตัวเลขดิบ/ขนาด surprise มาจากปฏิทินล้วน ๆ ไม่ต้องใช้ราคาเลย
   * จึงต้องเก็บแยกจาก rows — ไม่งั้นแถวที่เก่ากว่าหน้าต่างราคา 60 วันของ Yahoo
   * จะถูกข้ามทั้งแถวและไม่มีวันได้ค่าย้อนหลัง
   */
  const meta: { id: string; actualRaw: number | null; forecastRaw: number | null; surprisePct: number | null }[] = [];

  for (const event of events) {
    const bias = annotate(event);
    // เก็บเฉพาะข่าวตัวเลขที่มี surprise ชัด — ข่าวแถลง (tone) วัดทิศทางแบบนี้ไม่ได้
    if (bias.kind !== "number") continue;
    if (bias.surprise !== "higher" && bias.surprise !== "lower") continue;
    if (isNoise(event) || event.importance < 0) continue;

    meta.push({
      id: event.id,
      actualRaw: event.actualRaw,
      forecastRaw: event.forecastRaw,
      surprisePct: surpriseMagnitude(event),
    });

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
      actualRaw: event.actualRaw,
      forecastRaw: event.forecastRaw,
      surprisePct: surpriseMagnitude(event),
      ...measured,
    });
  }
  if (!rows.length && !meta.length) {
    return {
      added: 0, measured: 0, total: await count(),
      withSurprise: await countSurprise(), withExcursion: await countExcursion(),
    };
  }

  const before = await count();

  // INSERT ก่อน (ของใหม่) แล้วค่อย UPDATE เติมช่องว่างของแถวเดิม
  const statements = rows.flatMap((r) => [
    {
      sql: `INSERT INTO reactions (id, ts, key, title, country, importance, surprise, pred,
              m5, m10, m15, m30, m60, rng60, actual_raw, forecast_raw, surprise_pct,
              up15, dn15, up60, dn60)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
      args: [r.id, r.ts, r.key, r.title, r.country, r.importance, r.surprise, r.pred,
             r.m5, r.m10, r.m15, r.m30, r.m60, r.rng60,
             r.actualRaw, r.forecastRaw, r.surprisePct,
             r.up15, r.dn15, r.up60, r.dn60],
    },
    {
      // เติมช่องที่ยังว่างของแถวเดิม — รอบนี้รวมคอลัมน์ขนาด surprise ที่เพิ่งเพิ่มเข้ามา
      // แถวเก่าทั้งหมดจึงได้ค่าย้อนหลังจากการเรียก /api/collect?backfill=1 ครั้งเดียว
      sql: `UPDATE reactions SET
              m5 = COALESCE(m5, ?), m10 = COALESCE(m10, ?), m15 = COALESCE(m15, ?),
              m30 = COALESCE(m30, ?), m60 = COALESCE(m60, ?), rng60 = COALESCE(rng60, ?),
              actual_raw = COALESCE(actual_raw, ?), forecast_raw = COALESCE(forecast_raw, ?),
              surprise_pct = COALESCE(surprise_pct, ?),
              up15 = COALESCE(up15, ?), dn15 = COALESCE(dn15, ?),
              up60 = COALESCE(up60, ?), dn60 = COALESCE(dn60, ?)
            WHERE id = ?`,
      args: [r.m5, r.m10, r.m15, r.m30, r.m60, r.rng60,
             r.actualRaw, r.forecastRaw, r.surprisePct,
             r.up15, r.dn15, r.up60, r.dn60, r.id],
    },
  ]);

  // เติมตัวเลขดิบให้แถวที่มีอยู่แล้ว ทำแยกจากข้างบนเพราะไม่ผูกกับว่าวัดราคาได้ไหม
  // (COALESCE ทำให้เรียกซ้ำกี่รอบก็ไม่ทับค่าที่มีอยู่)
  statements.push(
    ...meta.map((m) => ({
      sql: `UPDATE reactions SET
              actual_raw = COALESCE(actual_raw, ?), forecast_raw = COALESCE(forecast_raw, ?),
              surprise_pct = COALESCE(surprise_pct, ?)
            WHERE id = ?`,
      args: [m.actualRaw, m.forecastRaw, m.surprisePct, m.id],
    })),
  );

  // แบ่งเป็นก้อนกันคำสั่งยาวเกินขีดจำกัดของ libSQL
  const CHUNK = 200;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK), "write");
  }

  const after = await count();
  // "measured" = จำนวนข่าวที่วัดได้ในรอบนี้ (ส่วนใหญ่มีอยู่แล้ว)
  // ไม่รายงานว่า "เติม" กี่แถว เพราะ COALESCE ไม่บอกว่าแถวไหนเปลี่ยนจริง
  return {
    added: after - before,
    measured: rows.length,
    total: after,
    withSurprise: await countSurprise(),
    withExcursion: await countExcursion(),
  };
}

async function count(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const res = await db.execute("SELECT COUNT(*) AS n FROM reactions");
  return Number(res.rows[0]?.n ?? 0);
}

/** กี่แถวที่มีขนาด surprise แล้ว — ใช้ตรวจว่า backfill เดินครบจริงไหม */
async function countSurprise(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const res = await db.execute("SELECT COUNT(*) AS n FROM reactions WHERE surprise_pct IS NOT NULL");
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * กี่แถวที่มีระยะวิ่งสุดขีดแล้ว
 *
 * ต่างจาก surprise ตรงที่อันนี้ต้องใช้ราคา จึงเติมย้อนหลังได้เฉพาะแถวที่ยังอยู่ใน
 * หน้าต่าง 60 วันของ Yahoo — แถวที่หลุดไปแล้วจะเป็น null ตลอดไป
 */
async function countExcursion(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const res = await db.execute("SELECT COUNT(*) AS n FROM reactions WHERE up15 IS NOT NULL");
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
    actualRaw: num(row.actual_raw),
    forecastRaw: num(row.forecast_raw),
    surprisePct: num(row.surprise_pct),
    up15: num(row.up15), dn15: num(row.dn15),
    up60: num(row.up60), dn60: num(row.dn60),
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

export function median(values: number[]): number | null {
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

export interface SurpriseSplit {
  /** เกณฑ์แบ่ง = มัธยฐานของขนาด surprise ในกลุ่มที่ใช้ */
  threshold: number | null;
  /** กี่แถวที่มีขนาด surprise ให้ใช้ (เทียบกับ total จะรู้ว่า backfill ครบหรือยัง) */
  covered: number;
  total: number;
  segments: Segment[];
}

/**
 * แยกตามขนาด surprise — ข่าวที่พลาดเป้ามากทำให้ทองวิ่งแรงและตรงทางกว่าไหม
 *
 * ใช้เฉพาะข่าวใหญ่สหรัฐฯ เพราะเป็นกลุ่มเดียวที่มีขอบได้เปรียบให้วัด
 * และแบ่งที่มัธยฐานของกลุ่มเอง ไม่ใช่เลขตายตัว จะได้ไม่ต้องเดาว่า "มาก" คือเท่าไหร่
 *
 * ข้อจำกัดที่ต้องบอกเสมอ: % เทียบคาดการณ์ของข่าวคนละหน่วยเทียบกันไม่ได้สนิท
 * และตอนวัดครั้งแรกได้ n แค่ 17 ต่อกลุ่ม ซึ่งยังสรุปไม่ได้
 */
export function surpriseSplit(records: ReactionRecord[]): SurpriseSplit {
  const pool = records.filter((r) => r.country === "US" && r.importance === 1);
  const withPct = pool.filter((r) => r.surprisePct !== null);
  const threshold = median(withPct.map((r) => r.surprisePct as number));

  // ต้องมีพอให้ทั้งสองฝั่งถึงเกณฑ์ขั้นต่ำ ไม่งั้นโชว์ % ไปก็หลอกตัวเอง
  if (threshold === null || withPct.length < MIN_SAMPLE * 2) {
    return { threshold, covered: withPct.length, total: pool.length, segments: [] };
  }

  const large = withPct.filter((r) => (r.surprisePct as number) > threshold);
  const small = withPct.filter((r) => (r.surprisePct as number) <= threshold);
  return {
    threshold,
    covered: withPct.length,
    total: pool.length,
    segments: [
      { label: `พลาดเป้ามาก (เกิน ${threshold}%)`, n: large.length, curve: decayCurve(large) },
      { label: `พลาดเป้าน้อย (ไม่เกิน ${threshold}%)`, n: small.length, curve: decayCurve(small) },
    ].filter((seg) => seg.n >= MIN_SAMPLE),
  };
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
  surprise: SurpriseSplit;
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
    surprise: surpriseSplit(records),
    noise15: newsNoise(records, 15),
    configured,
  };
}
