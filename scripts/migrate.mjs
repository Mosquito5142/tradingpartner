/**
 * ย้ายคลัง Reaction Lab จากไฟล์ JSON ของเวอร์ชัน Python เข้า Turso
 *
 *   node scripts/migrate.mjs               (ใช้ data/reactions.seed.json)
 *   node scripts/migrate.mjs path/to.json
 *
 * อ่านค่า TURSO_DATABASE_URL / TURSO_AUTH_TOKEN จาก .env.local
 * ถ้ายังไม่ได้ตั้ง จะใช้ไฟล์ SQLite ในเครื่อง (file:local.db) เพื่อทดสอบ
 *
 * รันซ้ำได้ ของเดิมไม่ถูกทับ (ON CONFLICT DO NOTHING)
 */

import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// อ่าน .env.local แบบง่าย ๆ — สคริปต์นี้รันนอก Next จึงไม่มีตัวโหลดให้
try {
  for (const line of readFileSync(resolve(process.cwd(), ".env.local"), "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* ไม่มี .env.local ก็ไม่เป็นไร */
}

const source = process.argv[2] || "data/reactions.seed.json";
const url = process.env.TURSO_DATABASE_URL || "file:local.db";
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

console.log(`ปลายทาง: ${url}`);
console.log(`ต้นทาง  : ${source}`);

await client.execute(`
CREATE TABLE IF NOT EXISTS reactions (
  id TEXT PRIMARY KEY, ts INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
  country TEXT NOT NULL, importance INTEGER NOT NULL, surprise TEXT NOT NULL, pred TEXT NOT NULL,
  m5 REAL, m10 REAL, m15 REAL, m30 REAL, m60 REAL, rng60 REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
)`);
for (const sql of [
  "CREATE INDEX IF NOT EXISTS idx_reactions_key ON reactions(key)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_ts ON reactions(ts)",
  "CREATE INDEX IF NOT EXISTS idx_reactions_country_imp ON reactions(country, importance)",
]) {
  await client.execute(sql);
}

const before = Number((await client.execute("SELECT COUNT(*) n FROM reactions")).rows[0].n);

const raw = JSON.parse(readFileSync(resolve(process.cwd(), source), "utf8"));
const entries = Object.entries(raw.events ?? {});
console.log(`พบ ${entries.length} รายการในไฟล์ต้นทาง`);

const statements = entries.map(([id, r]) => ({
  sql: `INSERT INTO reactions (id, ts, key, title, country, importance, surprise, pred, m5, m10, m15, m30, m60, rng60)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`,
  args: [
    String(id), r.ts, r.key ?? "", r.title ?? "", r.country ?? "", r.importance ?? 0,
    r.surprise ?? "", r.pred ?? "",
    r.m5 ?? null, r.m10 ?? null, r.m15 ?? null, r.m30 ?? null, r.m60 ?? null, r.rng60 ?? null,
  ],
}));

const CHUNK = 200;
for (let i = 0; i < statements.length; i += CHUNK) {
  await client.batch(statements.slice(i, i + CHUNK), "write");
  process.stdout.write(`\r  เขียนแล้ว ${Math.min(i + CHUNK, statements.length)}/${statements.length}`);
}

const after = Number((await client.execute("SELECT COUNT(*) n FROM reactions")).rows[0].n);
console.log(`\n✅ เพิ่มใหม่ ${after - before} รายการ · รวมในคลัง ${after}`);
