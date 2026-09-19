/**
 * เก็บข้อมูลปฏิกิริยาข่าวลงคลัง
 *
 * เรียกโดย Vercel Cron (ดู vercel.json) หรือเรียกเองเพื่อ backfill:
 *   /api/collect              เก็บข่าว 60 วันล่าสุด
 *   /api/collect?backfill=1   เก็บย้อนหลังเท่าที่แหล่งข้อมูลมี
 *
 * ถ้าตั้ง CRON_SECRET ไว้ จะต้องส่ง Authorization: Bearer <secret>
 * (Vercel Cron ส่งให้อัตโนมัติ) — เรียกจากเบราว์เซอร์เฉย ๆ จะโดนปฏิเสธ
 */

import { NextResponse } from "next/server";
import { fetchRange } from "@/lib/calendar";
import { CONFIG } from "@/lib/dashboard";
import { isConfigured } from "@/lib/db";
import { fetchGcf } from "@/lib/price";
import { updateStore } from "@/lib/reactions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // ยังไม่ตั้ง secret = เปิดให้เรียกได้ (สะดวกตอน dev)
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้งค่า TURSO_DATABASE_URL" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const backfill = url.searchParams.get("backfill") === "1";
  // Yahoo ให้แท่ง 5 นาทีย้อนหลังแค่ 60 วัน ดึงปฏิทินไกลกว่านั้นก็วัดอะไรไม่ได้
  const daysBack = backfill ? 60 : 7;

  try {
    const [events, bars] = await Promise.all([
      fetchRange(daysBack, 0, CONFIG.countries),
      fetchGcf("5m", "60d"),
    ]);

    const result = await updateStore(events, bars);
    return NextResponse.json({
      ok: true,
      scanned: events.length,
      bars: bars.length,
      ...result,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
