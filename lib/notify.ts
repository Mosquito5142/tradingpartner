/**
 * แจ้งเตือนผ่าน Telegram ก่อนข่าวใหญ่
 *
 * ส่งล่วงหน้า 30 นาที ไม่ใช่ตอนประกาศ เพราะขอบได้เปรียบที่วัดได้อยู่ใน 15 นาทีแรก
 * ถ้าเตือนตอนข่าวออกพอดี กว่าจะเปิดมือถือก็กินหน้าต่างไปครึ่งหนึ่งแล้ว
 *
 * ตั้งค่า env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
 * ไม่ได้ตั้ง = ระบบอื่นทำงานปกติ แค่ไม่ส่งแจ้งเตือน (degrade แบบนุ่มนวล)
 *
 * *** เป็นการแจ้งกำหนดการและสถิติย้อนหลัง ไม่ใช่สัญญาณซื้อขาย ***
 */

import { annotate, isKeyEvent } from "./bias";
import { buildCard, EDGE_WINDOW_MIN, type BriefingCard } from "./briefing";
import { loadCalendar } from "./calendar";
import { ensureSchema, getDb } from "./db";
import { allRecords } from "./reactions";
import { nowSec, thDateTime } from "./time";
import { isNoise, thaiTitle } from "./translate";
import type { AnnotatedEvent, ReactionRecord } from "./types";

/** ส่งก่อนข่าวกี่นาที */
export const LEAD_MIN = 30;
/**
 * scheduler อาจยิงช้าหรือหลุดไปบางรอบ จึงยอมส่งย้อนหลังได้ถึงก่อนข่าวกี่นาที
 * ต่ำกว่านี้ถือว่าสายเกินจะมีประโยชน์ — ปล่อยผ่านดีกว่าส่งข้อความที่ใช้ไม่ทัน
 */
export const MIN_LEAD_MIN = 5;

const API = "https://api.telegram.org";

export function isNotifyConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** ส่งข้อความ — คืน error เป็นข้อความแทนที่จะ throw เพื่อให้ cron รายงานได้ครบทุกรายการ */
export async function sendTelegram(html: string): Promise<{ ok: boolean; error?: string }> {
  if (!isNotifyConfigured()) return { ok: false, error: "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID" };
  try {
    const res = await fetch(`${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      cache: "no-store",
    });
    const body = (await res.json()) as { ok?: boolean; description?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const DIR_TH: Record<string, string> = { up: "▲ ทองขึ้น", down: "▼ ทองลง" };

/** การ์ดก่อนข่าว — เนื้อหาเดียวกับ BriefingCard บนเว็บ แต่เป็นข้อความ */
export function formatCard(card: BriefingCard, minutesLeft: number): string {
  const lines: string[] = [];

  lines.push(`⏰ <b>อีก ${minutesLeft} นาที</b> — ${esc(card.title)}`);
  lines.push(`${esc(card.country)} · ${esc(card.when)} น. · ${esc(card.titleEn)}`);

  if (card.forecast || card.previous) {
    const parts: string[] = [];
    if (card.forecast) parts.push(`คาดการณ์ <b>${esc(card.forecast)}</b>`);
    if (card.previous) parts.push(`ครั้งก่อน <b>${esc(card.previous)}</b>`);
    lines.push("", parts.join(" · "));
  }

  if (card.kind === "tone") {
    lines.push("", "ทิศทางตามทฤษฎี: โทนผ่อนคลาย → ▲ ทองขึ้น · โทนเข้มงวด → ▼ ทองลง");
  } else if (card.theory.dirIfHigher) {
    const up = DIR_TH[card.theory.dirIfHigher];
    const down = DIR_TH[card.theory.dirIfHigher === "up" ? "down" : "up"];
    lines.push("", `ทิศทางตามทฤษฎี: สูงกว่าคาด → ${up} · ต่ำกว่าคาด → ${down}`);
  }
  if (card.theory.why) lines.push(`<i>${esc(card.theory.why)}</i>`);

  if (card.history.toneEvent) {
    lines.push("", "สถิติ: ข่าวแถลงไม่มีตัวเลขให้เทียบ วัดความแม่นแบบนี้ไม่ได้ ต้องฟังเนื้อหาเอง");
  } else if (card.history.enough) {
    const extra: string[] = [];
    if (card.history.medianMove15) extra.push(`ขยับมัธยฐาน $${card.history.medianMove15}`);
    if (card.history.medianRange60) extra.push(`กรอบ 1 ชม. $${card.history.medianRange60}`);
    lines.push(
      "",
      `สถิติของจริง: ทฤษฎีถูก <b>${card.history.accuracy15}%</b> ใน ${card.edgeWindowMin} นาทีแรก (n=${card.history.n})` +
        (extra.length ? ` · ${extra.join(" · ")}` : ""),
    );
  } else {
    lines.push(
      "",
      `สถิติ: ${card.history.n ? `เก็บได้ ${card.history.n} ครั้ง — ยังน้อยเกินสรุป` : "ยังไม่เคยเก็บข่าวตัวนี้"}`,
    );
  }

  if (card.levels?.resistance || card.levels?.support) {
    const parts: string[] = [];
    if (card.levels.resistance) parts.push(`ต้าน ${card.levels.resistance.price.toLocaleString()}`);
    if (card.levels.support) parts.push(`รับ ${card.levels.support.price.toLocaleString()}`);
    lines.push("", `แนวใกล้ตัว: ${parts.join(" · ")}`);
  }

  lines.push(
    "",
    `⚠️ ขอบได้เปรียบอยู่ราว 5–${EDGE_WINDOW_MIN} นาทีแรกเท่านั้น หลัง 30 นาทีความแม่นตกเหลือ ~50%`,
    "ช่วงข่าวผันผวนสูง แนวรับแนวต้านมีโอกาสพังมากกว่าเด้ง (44.2% จาก n=346)",
    "<i>เป็นสถิติย้อนหลัง ไม่ใช่คำแนะนำการลงทุน</i>",
  );

  return lines.join("\n");
}

export interface PendingAlert {
  id: string;
  eventId: string;
  eventTs: number;
  minutesLeft: number;
  title: string;
  text: string;
}

/** ถึงเวลาต้องเตือนข่าวนี้แล้วหรือยัง */
export function isDue(eventTs: number, now: number): boolean {
  const left = (eventTs - now) / 60;
  return left <= LEAD_MIN && left >= MIN_LEAD_MIN;
}

/** ข่าวที่คุ้มแจ้งเตือน — เกณฑ์เดียวกับหน้า /live */
function worth(i: AnnotatedEvent): boolean {
  return i.bias.volatile || i.event.importance === 1 || i.bias.key;
}

/**
 * เลือกข่าวที่ถึงเวลาเตือนแล้วแปลงเป็นข้อความ
 *
 * แยกจาก pendingAlerts เพื่อให้ทดสอบได้โดยไม่ต้องรอให้ปฏิทินจริงมีข่าวพอดี
 */
export function alertsFor(
  items: AnnotatedEvent[],
  records: ReactionRecord[],
  now: number,
): PendingAlert[] {
  return items
    .filter(worth)
    .filter((i) => isDue(i.event.ts, now))
    .map((i) => {
      const minutesLeft = Math.round((i.event.ts - now) / 60);
      return {
        id: `${i.event.id}:pre`,
        eventId: i.event.id,
        eventTs: i.event.ts,
        minutesLeft,
        title: `${i.title} (${thDateTime(i.event.ts)})`,
        text: formatCard(buildCard(i, records), minutesLeft),
      };
    });
}

/** หาว่ามีข่าวไหนถึงเวลาต้องเตือนบ้าง (ยังไม่เช็กว่าส่งไปแล้วหรือยัง) */
export async function pendingAlerts(now = nowSec()): Promise<PendingAlert[]> {
  const [calendar, records] = await Promise.all([
    loadCalendar(0, 0.5, ["US", "EU", "CN"], 60),
    allRecords(),
  ]);

  const items: AnnotatedEvent[] = calendar.events
    .filter((e) => !isNoise(e) && (e.importance >= 0 || isKeyEvent(e)))
    .map((event) => {
      const bias = annotate(event);
      return { event, bias, title: thaiTitle(event) || bias.th || event.title };
    });

  return alertsFor(items, records, now);
}

/** เคยส่งไปแล้วหรือยัง — ไม่มี DB ก็ถือว่ายัง (ยอมเสี่ยงส่งซ้ำดีกว่าไม่ส่งเลย) */
export async function alreadySent(ids: string[]): Promise<Set<string>> {
  const db = getDb();
  if (!db || !ids.length) return new Set();
  await ensureSchema();
  const res = await db.execute({
    sql: `SELECT id FROM alerts_sent WHERE id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  return new Set(res.rows.map((r) => String(r.id)));
}

export async function markSent(alert: PendingAlert): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute({
    sql: `INSERT INTO alerts_sent (id, event_id, kind, event_ts) VALUES (?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING`,
    args: [alert.id, alert.eventId, "pre", alert.eventTs],
  });
}
