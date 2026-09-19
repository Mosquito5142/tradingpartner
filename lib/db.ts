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

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_reactions_key ON reactions(key)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_ts ON reactions(ts)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_country_imp ON reactions(country, importance)",
];

/** สร้างตารางถ้ายังไม่มี — เรียกซ้ำได้ ทำจริงครั้งเดียวต่อ process */
export async function ensureSchema(): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (!ready) {
    ready = (async () => {
      await db.execute(SCHEMA);
      for (const sql of INDEXES) await db.execute(sql);
    })().catch((err) => {
      ready = null; // ให้ลองใหม่ได้ในครั้งถัดไป
      throw err;
    });
  }
  return ready;
}
