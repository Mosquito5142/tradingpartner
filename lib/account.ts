/**
 * ข้อมูลบัญชีและสถิติภาพรวมสำหรับหน้า /profile
 *
 * แยกจาก lib/trades.ts เพราะตรงนี้ตอบคำถาม "บัญชีนี้เป็นยังไง" ไม่ใช่ "ไม้ไหนเป็นยังไง"
 * และเก็บยอดเงินจากหัวรายงานแทนที่จะฝังไว้ในโค้ด — ยอดเปลี่ยนทุกครั้งที่เทรด
 * ค่าที่ hardcode ไว้จึงล้าสมัยทันทีและทำให้ %เสี่ยงทั้งหน้าผิดตาม
 *
 * *** เป็นการสรุปสถิติย้อนหลัง ไม่ใช่คำแนะนำการลงทุน ***
 */

import { ensureSchema, getDb } from "./db";
import type { AccountInfo } from "./mt5-import";
import type { Trade } from "./trades";

const round2 = (n: number) => Math.round(n * 100) / 100;
const netOf = (t: Trade) => t.profit + t.commission + t.swap;

export async function saveAccount(info: AccountInfo): Promise<void> {
  const db = getDb();
  if (!db || !info.id) return;
  await ensureSchema();
  await db.execute({
    sql: `INSERT INTO account (id, currency, server, company, kind, mode, balance, equity, updated_at)
          VALUES (?,?,?,?,?,?,?,?,unixepoch())
          ON CONFLICT(id) DO UPDATE SET
            currency = excluded.currency, server = excluded.server, company = excluded.company,
            kind = excluded.kind, mode = excluded.mode,
            -- ยอดเงินอาจไม่มีในรายงานบางแบบ อย่าทับของเดิมด้วย null
            balance = COALESCE(excluded.balance, account.balance),
            equity = COALESCE(excluded.equity, account.equity),
            updated_at = unixepoch()`,
    args: [info.id, info.currency, info.server, info.company, info.kind, info.mode,
           info.balance, info.equity],
  });
}

export interface StoredAccount extends AccountInfo {
  updatedAt: number;
}

/** บัญชีที่อัปเดตล่าสุด — รองรับกรณีนำเข้าหลายบัญชี */
export async function loadAccount(): Promise<StoredAccount | null> {
  const db = getDb();
  if (!db) return null;
  try {
    await ensureSchema();
    const res = await db.execute("SELECT * FROM account ORDER BY updated_at DESC LIMIT 1");
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      id: String(row.id),
      currency: String(row.currency ?? ""),
      server: String(row.server ?? ""),
      company: String(row.company ?? ""),
      kind: String(row.kind ?? ""),
      mode: String(row.mode ?? ""),
      balance: num(row.balance),
      equity: num(row.equity),
      updatedAt: Number(row.updated_at ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * ช่วงความเชื่อมั่นของอัตราชนะแบบ Wilson
 *
 * ใช้แทนสูตรปกติเพราะที่ n น้อย ๆ สูตรปกติให้ช่วงที่ทะลุ 0-100% ได้
 * และแคบเกินจริง — ซึ่งจะทำให้ผู้ใช้มั่นใจในตัวเลขมากกว่าที่ควร
 */
export function wilson(wins: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, Math.round(((centre - spread) / d) * 1000) / 10),
    Math.min(100, Math.round(((centre + spread) / d) * 1000) / 10),
  ];
}

export interface Equity {
  /** กำไรสะสมหลังแต่ละไม้ (เรียงตามเวลาปิด) */
  curve: { ts: number; cum: number }[];
  /** ถอยจากยอดสูงสุดมากที่สุดกี่หน่วย */
  maxDrawdown: number;
  /** คิดเป็นกี่ % ของยอดสูงสุด ณ ตอนนั้น */
  maxDrawdownPct: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

/**
 * เส้นกำไรสะสมและการถอยสูงสุด
 *
 * เรียงตามเวลา "ปิด" ไม่ใช่เวลาเปิด เพราะกำไรเข้าพอร์ตตอนปิด
 * (ไม้ที่เปิดก่อนแต่ปิดทีหลังจะเข้าทีหลัง ซึ่งตรงกับที่ยอดเงินขยับจริง)
 */
export function equityCurve(trades: Trade[], startBalance = 0): Equity {
  const closed = trades
    .filter((t) => t.closeTs !== null)
    .sort((a, b) => (a.closeTs as number) - (b.closeTs as number));

  const curve: Equity["curve"] = [];
  let cum = 0;
  let peak = startBalance;
  let maxDd = 0;
  let maxDdPct = 0;
  let win = 0;
  let loss = 0;
  let bestWin = 0;
  let bestLoss = 0;

  for (const t of closed) {
    const value = netOf(t);
    cum += value;
    curve.push({ ts: t.closeTs as number, cum: round2(cum) });

    const equity = startBalance + cum;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) {
      maxDd = dd;
      maxDdPct = peak > 0 ? (dd / peak) * 100 : 0;
    }

    if (value > 0) {
      win++;
      loss = 0;
      if (win > bestWin) bestWin = win;
    } else if (value < 0) {
      loss++;
      win = 0;
      if (loss > bestLoss) bestLoss = loss;
    }
  }

  return {
    curve,
    maxDrawdown: round2(maxDd),
    maxDrawdownPct: Math.round(maxDdPct * 10) / 10,
    longestWinStreak: bestWin,
    longestLossStreak: bestLoss,
  };
}

export interface LotProfile {
  latest: number;
  largest: number;
  median: number;
  /** ล็อตของ 5 ไม้ล่าสุด เรียงเก่า -> ใหม่ ใช้ดูว่ากำลังเพิ่มขนาดไหม */
  recent: number[];
  /** ขนาดล่าสุดโตกว่าค่ากลางกี่เท่า */
  growth: number | null;
}

export function lotProfile(trades: Trade[]): LotProfile | null {
  if (!trades.length) return null;
  const byTime = [...trades].sort((a, b) => a.openTs - b.openTs);
  const lots = byTime.map((t) => t.lots);
  const sorted = [...lots].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const latest = lots[lots.length - 1];
  return {
    latest,
    largest: Math.max(...lots),
    median: round2(median),
    recent: lots.slice(-5),
    growth: median > 0 ? Math.round((latest / median) * 10) / 10 : null,
  };
}
