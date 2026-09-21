/**
 * ตรวจว่ามีข่าวใหญ่ใกล้จะประกาศไหม แล้วส่งการ์ดสรุปเข้า Telegram
 *
 *   /api/cron/alert         ตรวจแล้วส่งจริง
 *   /api/cron/alert?dry=1   ดูว่าจะส่งอะไรบ้างโดยไม่ส่งจริง (ใช้ทดสอบ)
 *   /api/cron/alert?test=1  ส่งข้อความทดสอบเข้า Telegram เพื่อเช็กว่าตั้งค่าถูก
 *
 * ต้องถูกเรียกทุก ๆ ~10 นาทีถึงจะทันหน้าต่าง 30 นาที
 * Vercel แผนฟรีรัน cron ได้วันละครั้งเท่านั้น จึงต้องใช้ตัวตั้งเวลาภายนอก
 * (cron-job.org / GitHub Actions) ยิงเข้ามาที่ endpoint นี้ — ดู README
 *
 * ถ้าตั้ง CRON_SECRET ไว้ ต้องส่ง Authorization: Bearer <secret> มาด้วย
 */

import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import {
  alreadySent, formatCard, isNotifyConfigured, LEAD_MIN, markSent, pendingAlerts, sendTelegram,
} from "@/lib/notify";

/** ตัวอย่างข้อความ ใช้ตอน dry run ที่ไม่มีข่าวในหน้าต่าง */
const sampleMessage = () =>
  formatCard(
    {
      ts: 0, when: "(ตัวอย่าง)", title: "การจ้างงานนอกภาคเกษตร (NFP)",
      titleEn: "Non-Farm Payrolls", country: "US", importance: 1, volatile: true, kind: "number",
      forecast: "225K", previous: "218K", actual: "", surprise: "", outcome: "",
      theory: { dirIfHigher: "down", why: "จ้างงานดีเกินคาด → เฟดไม่ต้องรีบลดดอกเบี้ย → ทองลง" },
      edgeWindowMin: 15,
      history: { key: "NFP", n: 12, enough: true, accuracy15: 71, medianMove15: 8.9, medianRange60: 21.4, recent: [] },
    },
    30,
  );

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get("dry") === "1";

  if (url.searchParams.get("test") === "1") {
    const res = await sendTelegram(
      "✅ <b>ทดสอบการเชื่อมต่อ</b>\nบอทแจ้งเตือนข่าวทองตั้งค่าถูกต้องแล้ว",
    );
    return NextResponse.json({ ok: res.ok, mode: "test", error: res.error }, { status: res.ok ? 200 : 502 });
  }

  if (!dry && !isNotifyConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID" },
      { status: 503 },
    );
  }

  try {
    const pending = await pendingAlerts();
    // ไม่มี DB = กันซ้ำไม่ได้ ต้องบอกตรง ๆ ไม่ใช่เงียบแล้วปล่อยให้ผู้ใช้โดนสแปม
    const sentBefore = isConfigured() ? await alreadySent(pending.map((p) => p.id)) : new Set<string>();
    const todo = pending.filter((p) => !sentBefore.has(p.id));

    if (dry) {
      return NextResponse.json({
        ok: true, mode: "dry", leadMin: LEAD_MIN,
        found: pending.length, skippedAsSent: pending.length - todo.length,
        dedupe: isConfigured() ? "on" : "off (ไม่ได้ตั้งค่า Turso)",
        telegram: isNotifyConfigured() ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า",
        wouldSend: todo.map((p) => ({ title: p.title, minutesLeft: p.minutesLeft, text: p.text })),
        // ไม่มีข่าวในหน้าต่างเป็นเรื่องปกติ (ส่วนใหญ่ของวันไม่มี) จึงโชว์ตัวอย่างไว้
        // ให้เห็นหน้าตาข้อความ ไม่งั้นแยกไม่ออกว่า "ไม่มีข่าว" กับ "พัง" ต่างกันยังไง
        ...(todo.length ? {} : { sample: sampleMessage() }),
      });
    }

    const results: { title: string; ok: boolean; error?: string }[] = [];
    for (const alert of todo) {
      const res = await sendTelegram(alert.text);
      // บันทึกเฉพาะที่ส่งสำเร็จ ถ้าล้มเหลวปล่อยให้รอบหน้าลองใหม่
      if (res.ok) await markSent(alert);
      results.push({ title: alert.title, ok: res.ok, error: res.error });
    }

    return NextResponse.json({
      ok: results.every((r) => r.ok),
      found: pending.length,
      sent: results.filter((r) => r.ok).length,
      skippedAsSent: pending.length - todo.length,
      dedupe: isConfigured() ? "on" : "off (ไม่ได้ตั้งค่า Turso — อาจส่งซ้ำ)",
      results,
    });
  } catch (err) {
    console.error("[api/cron/alert]", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
