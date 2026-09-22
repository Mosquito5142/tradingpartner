/**
 * Turso (libSQL) — คลังสถิติปฏิกิริยาข่าวที่สะสมถาวร
 *
 * ทำไมต้องมีฐานข้อมูล: Yahoo ให้แท่ง 5 นาทีย้อนหลังแค่ 60 วัน
 * ถ้าไม่เก็บเอง ตัวอย่างจะไม่มีวันโตพอจะสรุปรายข่าวได้
 * และบน Vercel ไฟล์ในดิสก์หายทุกครั้งที่ deploy จึงเก็บลง Turso แทน
 *
 * ตั้งค่า env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 * ถ้าไม่ได้ตั้ง แอปจะยังทำงานได้ปกติ แค่ส่วน Reaction Lab จะว่าง (degrade แบบนุ่มนวล)
 */

import { createClient, type Client } from "@libsql/client";

let client: Client | null = null;
let ready: Promise<void> | null = null;

export function isConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

export function getDb(): Client | null {
  if (!isConfigured()) return null;
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return client;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reactions (
  id          TEXT PRIMARY KEY,
  ts          INTEGER NOT NULL,
  key         TEXT NOT NULL,
  title       TEXT NOT NULL,
  country     TEXT NOT NULL,
  importance  INTEGER NOT NULL,
  surprise    TEXT NOT NULL,
  pred        TEXT NOT NULL,
  m5          REAL,
  m10         REAL,
  m15         REAL,
  m30         REAL,
  m60         REAL,
  rng60       REAL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
)`;

/**
 * สมุดบันทึกเทรด — ไม้ที่ผู้ใช้เทรดจริง
 *
 * ticket = เลขที่ออเดอร์จากโบรกเกอร์ ใช้เป็น primary key เพื่อกันนำเข้าซ้ำ
 * ไม้ที่กรอกมือจะได้ id ขึ้นต้นด้วย "manual:"
 *
 * ช่องที่ลงท้ายด้วย _tag คือป้ายที่โปรแกรมคำนวณให้ตอนนำเข้า
 */
const TRADES_SCHEMA = `
CREATE TABLE IF NOT EXISTS trades (
  ticket       TEXT PRIMARY KEY,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL,
  lots         REAL NOT NULL,
  open_ts      INTEGER NOT NULL,
  close_ts     INTEGER,
  open_price   REAL NOT NULL,
  close_price  REAL,
  sl           REAL,
  tp           REAL,
  profit       REAL NOT NULL,
  commission   REAL NOT NULL DEFAULT 0,
  swap         REAL NOT NULL DEFAULT 0,
  comment      TEXT NOT NULL DEFAULT '',
  session_tag  TEXT NOT NULL DEFAULT '',
  news_tag     TEXT NOT NULL DEFAULT '',
  hold_min     INTEGER,
  risk_pct     REAL,
  r_multiple   REAL,
  source       TEXT NOT NULL DEFAULT 'import',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
)`;

/**
 * กันส่งแจ้งเตือนซ้ำ
 *
 * id = "<event id>:<ชนิดแจ้งเตือน>" — ตัว scheduler ยิงเข้ามาทุกกี่นาทีก็ได้
 * โดยไม่ต้องกลัวว่าผู้ใช้จะโดนข้อความเดิมรัว ๆ ซึ่งเป็นเรื่องที่ทำให้คนปิดบอททิ้ง
 */
const ALERTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts_sent (
  id       TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  kind     TEXT NOT NULL,
  event_ts INTEGER NOT NULL,
  sent_at  INTEGER NOT NULL DEFAULT (unixepoch())
)`;

/**
 * ข้อมูลบัญชีจากหัวรายงาน
 *
 * มีไว้เพื่อเลิก hardcode ยอดเงินในโค้ด — ยอดเปลี่ยนทุกครั้งที่เทรด
 * ค่าที่ฝังไว้จึงล้าสมัยทันทีและทำให้ %เสี่ยงทั้งหน้าผิดตาม
 */
const ACCOUNT_SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
  id         TEXT PRIMARY KEY,
  currency   TEXT NOT NULL DEFAULT '',
  server     TEXT NOT NULL DEFAULT '',
  company    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT '',
  mode       TEXT NOT NULL DEFAULT '',
  balance    REAL,
  equity     REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)`;

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_reactions_key ON reactions(key)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_ts ON reactions(ts)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_country_imp ON reactions(country, importance)",
  "CREATE INDEX IF NOT EXISTS idx_trades_open ON trades(open_ts)",
  "CREATE INDEX IF NOT EXISTS idx_trades_session ON trades(session_tag)",
  "CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts_sent(event_ts)",
];

/**
 * เพิ่มคอลัมน์ใหม่ให้ตารางเดิม — SQLite ไม่มี "ADD COLUMN IF NOT EXISTS"
 * จึงต้องยอมให้ error "duplicate column" ผ่านไป (แปลว่ามีอยู่แล้ว)
 */
const MIGRATIONS = [
  "ALTER TABLE reactions ADD COLUMN actual_raw REAL",
  "ALTER TABLE reactions ADD COLUMN forecast_raw REAL",
  "ALTER TABLE reactions ADD COLUMN surprise_pct REAL",
  // ระยะที่ราคาวิ่งขึ้น/ลงไกลสุดหลังข่าว เทียบราคาก่อนประกาศ (ไม่ติดลบทั้งคู่)
  // เก็บแบบไม่ผูกทิศทาง แล้วค่อยแปลงเป็น MFE/MAE ตอนอ่านตามทิศที่ทฤษฎีชี้
  // ถ้าวันหลังแก้กฎใน bias.ts ข้อมูลเก่าจะยังใช้ได้ต่อ
  "ALTER TABLE reactions ADD COLUMN up15 REAL",
  "ALTER TABLE reactions ADD COLUMN dn15 REAL",
  "ALTER TABLE reactions ADD COLUMN up60 REAL",
  "ALTER TABLE reactions ADD COLUMN dn60 REAL",
  // สกุลเงินของบัญชี ดึงจากหัวรายงานตอนนำเข้า — ต้องรู้ถึงจะแปลงเป็นบาทได้ถูก
  // (USC ของบัญชี cent ต่างจาก USD อยู่ 100 เท่า)
  "ALTER TABLE trades ADD COLUMN currency TEXT NOT NULL DEFAULT ''",
];

/** สร้างตาราง/คอลัมน์ถ้ายังไม่มี — เรียกซ้ำได้ ทำจริงครั้งเดียวต่อ process */
export async function ensureSchema(): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (!ready) {
    ready = (async () => {
      await db.execute(SCHEMA);
      await db.execute(TRADES_SCHEMA);
      await db.execute(ALERTS_SCHEMA);
      await db.execute(ACCOUNT_SCHEMA);
      for (const sql of MIGRATIONS) {
        try {
          await db.execute(sql);
        } catch (err) {
          // มีคอลัมน์อยู่แล้ว = ปกติ อย่างอื่นคือปัญหาจริง ต้องโยนต่อ
          if (!/duplicate column/i.test(String(err))) throw err;
        }
      }
      for (const sql of INDEXES) await db.execute(sql);
    })().catch((err) => {
      ready = null; // ให้ลองใหม่ได้ในครั้งถัดไป
      throw err;
    });
  }
  return ready;
}
