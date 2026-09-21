/**
 * สมุดบันทึกเทรด — เก็บไม้ที่เทรดจริงแล้ววัดผลงานของผู้ใช้เอง
 *
 * ทำไมถึงสำคัญกว่าทุกอย่างที่สร้างมา: เครื่องมืออื่นวัด "ตลาด" ทั้งหมด
 * แต่ไม่เคยวัด "คนเทรด" เลย ทั้งที่การบริหารความเสี่ยงมีผลต่อผลลัพธ์มากกว่าคุณภาพสัญญาณ
 *
 * *** เป็นการวัดสถิติย้อนหลัง ไม่ใช่คำแนะนำการลงทุน ***
 */

import { annotate } from "./bias";
import { loadCalendar } from "./calendar";
import { ensureSchema, getDb } from "./db";
import { sessionName } from "./hours";
import { thParts } from "./time";
import { isNoise } from "./translate";
import type { ParsedTrade } from "./mt5-import";

/** 1 ล็อต XAUUSD = 100 ออนซ์ — ตรงกับสูตรในเครื่องคำนวณล็อต */
const CONTRACT = 100;

/** ถือว่าไม้นี้ "เทรดช่วงข่าว" ถ้าเปิดภายในกี่นาทีรอบเวลาประกาศ */
const NEWS_WINDOW_MIN = 30;

export interface Trade extends ParsedTrade {
  /** สกุลเงินของบัญชี เช่น USD หรือ USC — ว่างถ้าไฟล์ไม่ได้บอก */
  currency: string;
  sessionTag: string;
  newsTag: string;
  holdMin: number | null;
  riskPct: number | null;
  rMultiple: number | null;
  source: string;
}

export interface TradeStats {
  n: number;
  wins: number;
  winRate: number;
  netProfit: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
}

function emptyStats(): TradeStats {
  return { n: 0, wins: 0, winRate: 0, netProfit: 0, avgWin: 0, avgLoss: 0, profitFactor: null };
}

export function summarize(trades: Trade[]): TradeStats {
  if (!trades.length) return emptyStats();
  const wins = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const grossWin = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  return {
    n: trades.length,
    wins: wins.length,
    winRate: Math.round((wins.length / trades.length) * 1000) / 10,
    netProfit: Math.round(trades.reduce((s, t) => s + t.profit + t.commission + t.swap, 0) * 100) / 100,
    avgWin: wins.length ? Math.round((grossWin / wins.length) * 100) / 100 : 0,
    avgLoss: losses.length ? Math.round((grossLoss / losses.length) * 100) / 100 : 0,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
  };
}

/**
 * ติดป้ายให้ทุกไม้ — เซสชัน, อยู่ในช่วงข่าวไหม, %เสี่ยง, R
 *
 * balance = ยอดเงินในบัญชี (หน่วยเดียวกับ profit ในไฟล์ statement)
 * ใช้คำนวณ %เสี่ยง ถ้าไม่ใส่มาจะข้ามการคำนวณนั้นแทนที่จะเดามั่ว
 *
 * currency = สกุลเงินของบัญชีจากหัวรายงาน ใช้แปลงเป็นบาทตอนแสดงผล
 * ปล่อยว่างได้ — หน้าเว็บจะไม่แปลงให้แทนที่จะเดาว่าเป็น USD แล้วผิดไป 100 เท่า
 */
export async function tagTrades(
  parsed: ParsedTrade[],
  balance?: number,
  currency = "",
): Promise<Trade[]> {
  // ดึงปฏิทินช่วงที่ครอบคลุมไม้ทั้งหมด เพื่อรู้ว่าไม้ไหนเทรดตอนมีข่าว
  let newsTimes: { ts: number; title: string }[] = [];
  if (parsed.length) {
    const oldest = Math.min(...parsed.map((t) => t.openTs));
    const daysBack = Math.ceil((Date.now() / 1000 - oldest) / 86400) + 1;
    try {
      const cal = await loadCalendar(Math.min(daysBack, 60), 1, ["US", "EU", "CN"]);
      newsTimes = cal.events
        .filter((e) => !isNoise(e) && (e.importance === 1 || annotate(e).volatile))
        .map((e) => ({ ts: e.ts, title: e.title }));
    } catch {
      // ดึงปฏิทินไม่ได้ก็ยังบันทึกไม้ได้ แค่ไม่มีป้ายข่าว
    }
  }

  const windowSec = NEWS_WINDOW_MIN * 60;

  return parsed.map((t) => {
    const near = newsTimes.find((n) => Math.abs(n.ts - t.openTs) <= windowSec);
    const holdMin = t.closeTs ? Math.round((t.closeTs - t.openTs) / 60) : null;

    // ความเสี่ยงที่ตั้งใจไว้ = ระยะจากราคาเข้าถึง SL (ถ้าตั้ง SL ไว้)
    let riskPct: number | null = null;
    let rMultiple: number | null = null;
    if (t.sl && t.sl > 0) {
      const slDistance = Math.abs(t.openPrice - t.sl);
      const riskAmount = slDistance * t.lots * CONTRACT;
      if (balance && balance > 0 && riskAmount > 0) {
        riskPct = Math.round((riskAmount / balance) * 1000) / 10;
      }
      if (riskAmount > 0) rMultiple = Math.round((t.profit / riskAmount) * 100) / 100;
    }

    return {
      ...t,
      currency,
      sessionTag: sessionName(thParts(t.openTs).hour),
      newsTag: near ? near.title : "",
      holdMin,
      riskPct,
      rMultiple,
      source: t.ticket.startsWith("manual:") ? "manual" : "import",
    };
  });
}

/** บันทึกลง Turso — ticket ซ้ำจะถูกเขียนทับ (นำเข้าไฟล์เดิมซ้ำได้ไม่เกิดรายการซ้ำ) */
export async function saveTrades(trades: Trade[]) {
  const db = getDb();
  if (!db) return { saved: 0, skipped: "ยังไม่ได้ตั้งค่า Turso" };
  if (!trades.length) return { saved: 0 };
  await ensureSchema();

  const statements = trades.map((t) => ({
    sql: `INSERT INTO trades (ticket, symbol, side, lots, open_ts, close_ts, open_price, close_price,
            sl, tp, profit, commission, swap, comment, session_tag, news_tag, hold_min, risk_pct, r_multiple,
            source, currency)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          -- ticket คือตัวตนของไม้ ฟิลด์อื่นเอาของรายงานใหม่เสมอ
          -- (จำเป็นสำหรับกรณีนำเข้าซ้ำเพื่อแก้ GMT ที่ตั้งผิด ถ้าไม่อัปเดต open_ts ด้วย
          --  เวลาเปิดจะค้างค่าเก่าแต่ป้ายเซสชันเปลี่ยน กลายเป็นขัดกันเอง)
          ON CONFLICT(ticket) DO UPDATE SET
            symbol = excluded.symbol, side = excluded.side, lots = excluded.lots,
            open_ts = excluded.open_ts, close_ts = excluded.close_ts,
            open_price = excluded.open_price, close_price = excluded.close_price,
            sl = excluded.sl, tp = excluded.tp,
            profit = excluded.profit, commission = excluded.commission, swap = excluded.swap,
            comment = excluded.comment,
            session_tag = excluded.session_tag, news_tag = excluded.news_tag,
            hold_min = excluded.hold_min, risk_pct = excluded.risk_pct,
            r_multiple = excluded.r_multiple, source = excluded.source,
            -- สกุลเงินทับเฉพาะเมื่อรายงานใหม่บอกมา ไม่งั้นการกรอกมือจะลบค่าที่เคยได้จากไฟล์ทิ้ง
            currency = CASE WHEN excluded.currency != '' THEN excluded.currency ELSE trades.currency END`,
    args: [t.ticket, t.symbol, t.side, t.lots, t.openTs, t.closeTs, t.openPrice, t.closePrice,
           t.sl, t.tp, t.profit, t.commission, t.swap, t.comment,
           t.sessionTag, t.newsTag, t.holdMin, t.riskPct, t.rMultiple, t.source, t.currency],
  }));

  const CHUNK = 100;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK), "write");
  }
  return { saved: trades.length };
}

function toTrade(row: Record<string, unknown>): Trade {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ticket: String(row.ticket),
    symbol: String(row.symbol),
    side: String(row.side) as "buy" | "sell",
    lots: Number(row.lots),
    openTs: Number(row.open_ts),
    closeTs: num(row.close_ts),
    openPrice: Number(row.open_price),
    closePrice: num(row.close_price),
    sl: num(row.sl),
    tp: num(row.tp),
    profit: Number(row.profit),
    commission: Number(row.commission ?? 0),
    swap: Number(row.swap ?? 0),
    comment: String(row.comment ?? ""),
    sessionTag: String(row.session_tag ?? ""),
    newsTag: String(row.news_tag ?? ""),
    holdMin: num(row.hold_min),
    riskPct: num(row.risk_pct),
    rMultiple: num(row.r_multiple),
    source: String(row.source ?? "import"),
    currency: String(row.currency ?? ""),
  };
}

export async function allTrades(): Promise<Trade[]> {
  const db = getDb();
  if (!db) return [];
  try {
    await ensureSchema();
    const res = await db.execute("SELECT * FROM trades ORDER BY open_ts DESC");
    return res.rows.map((r) => toTrade(r as unknown as Record<string, unknown>));
  } catch {
    return [];
  }
}

/**
 * สกุลเงินของบัญชีจากไม้ที่เก็บไว้ — ใช้ตัวที่พบบ่อยที่สุด
 *
 * ปกติทุกไม้มาจากบัญชีเดียวกันจึงเหมือนกันหมด แต่ถ้าเคยนำเข้าหลายบัญชีปนกัน
 * การเลือกตัวที่พบบ่อยสุดจะผิดน้อยกว่าเลือกตัวแรกที่เจอ
 */
export function accountCurrency(trades: Trade[]): string {
  const counts = new Map<string, number>();
  for (const t of trades) {
    if (t.currency) counts.set(t.currency, (counts.get(t.currency) ?? 0) + 1);
  }
  let best = "";
  let top = 0;
  for (const [cur, n] of counts) if (n > top) { best = cur; top = n; }
  return best;
}

export async function deleteAllTrades() {
  const db = getDb();
  if (!db) return;
  await ensureSchema();
  await db.execute("DELETE FROM trades");
}

/** แบ่งกลุ่มไม้ตามมิติต่าง ๆ แล้วสรุปสถิติแต่ละกลุ่ม */
export function groupStats(trades: Trade[], by: (t: Trade) => string) {
  const groups = new Map<string, Trade[]>();
  for (const t of trades) {
    const k = by(t);
    const list = groups.get(k) || [];
    list.push(t);
    groups.set(k, list);
  }
  return [...groups.entries()]
    .map(([label, list]) => ({ label, ...summarize(list) }))
    .sort((a, b) => b.n - a.n);
}

export const HOLD_BUCKETS = (t: Trade): string => {
  if (t.holdMin === null) return "ไม่รู้เวลาปิด";
  if (t.holdMin < 15) return "< 15 นาที";
  if (t.holdMin < 60) return "15–60 นาที";
  if (t.holdMin < 240) return "1–4 ชม.";
  return "> 4 ชม.";
};

export const RISK_BUCKETS = (t: Trade): string => {
  if (t.riskPct === null) return "ไม่ได้ตั้ง SL";
  if (t.riskPct < 1) return "< 1%";
  if (t.riskPct < 2) return "1–2%";
  if (t.riskPct < 5) return "2–5%";
  if (t.riskPct < 10) return "5–10%";
  return "เกิน 10%";
};
