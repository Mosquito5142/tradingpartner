/**
 * สวิตช์เปิด/ปิดการแจ้งเตือน
 *
 * เก็บใน Turso ไม่ใช่ localStorage เพราะตัวที่ส่งข้อความคือ cron ฝั่งเซิร์ฟเวอร์
 * ถ้าเก็บในเบราว์เซอร์ การปิดสวิตช์จะไม่มีผลกับการส่งจริงเลย
 *
 * ค่าเริ่มต้นเป็น "เปิด" ทั้งหมด เพื่อให้พฤติกรรมเดิมไม่เปลี่ยนตอนอัปเกรด
 */

import { ensureSchema, getDb } from "./db";

export interface NotifySettings {
  /** สวิตช์ใหญ่ — ปิดแล้วไม่ส่งอะไรเลย */
  enabled: boolean;
  /** เตือนก่อนข่าวใหญ่ 30 นาที */
  news: boolean;
  /** เตือนสภาพตลาดรอบแนวรับแนวต้าน */
  regime: boolean;
}

export const DEFAULTS: NotifySettings = { enabled: true, news: true, regime: true };

/** คีย์ที่ยอมให้เขียนได้ — กันคนยิง API แล้วใส่คีย์มั่ว */
export const KEYS: Record<keyof NotifySettings, string> = {
  enabled: "notify_enabled",
  news: "notify_news",
  regime: "notify_regime",
};

export function isSettingKey(key: string): key is keyof NotifySettings {
  return key in KEYS;
}

export async function loadNotifySettings(): Promise<NotifySettings> {
  const db = getDb();
  if (!db) return DEFAULTS;
  try {
    await ensureSchema();
    const res = await db.execute({
      sql: `SELECT key, value FROM settings WHERE key IN (?,?,?)`,
      args: [KEYS.enabled, KEYS.news, KEYS.regime],
    });
    const map = new Map(res.rows.map((r) => [String(r.key), String(r.value)]));
    const read = (k: string, fallback: boolean) =>
      map.has(k) ? map.get(k) === "1" : fallback;
    return {
      enabled: read(KEYS.enabled, DEFAULTS.enabled),
      news: read(KEYS.news, DEFAULTS.news),
      regime: read(KEYS.regime, DEFAULTS.regime),
    };
  } catch {
    // อ่านไม่ได้ก็ใช้ค่าเริ่มต้น ดีกว่าทำให้ทั้งหน้าพัง
    return DEFAULTS;
  }
}

export async function setNotifySetting(
  key: keyof NotifySettings,
  value: boolean,
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await ensureSchema();
  await db.execute({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    args: [KEYS[key], value ? "1" : "0"],
  });
}

/** ชนิดการเตือนนี้ส่งได้ไหม — รวมสวิตช์ใหญ่แล้ว */
export function canSend(s: NotifySettings, kind: "news" | "regime"): boolean {
  return s.enabled && s[kind];
}
