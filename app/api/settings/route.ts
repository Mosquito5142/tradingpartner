/**
 * เปิด/ปิดการแจ้งเตือน
 *
 *   GET             อ่านค่าปัจจุบัน
 *   POST {key,value} เปลี่ยนค่าทีละตัว
 *
 * ยอมรับเฉพาะคีย์ที่อยู่ในรายการ เพื่อไม่ให้ใครยิงค่ามั่วเข้าตาราง settings
 */

import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import { isSettingKey, loadNotifySettings, setNotifySetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, settings: await loadNotifySettings() });
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, error: "ยังไม่ได้ตั้งค่า TURSO_DATABASE_URL จึงจำค่าไม่ได้" },
      { status: 503 },
    );
  }

  let body: { key?: string; value?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "อ่าน body ไม่ได้" }, { status: 400 });
  }

  const key = String(body.key ?? "");
  if (!isSettingKey(key)) {
    return NextResponse.json({ ok: false, error: `ไม่รู้จักค่า "${key}"` }, { status: 400 });
  }
  if (typeof body.value !== "boolean") {
    return NextResponse.json({ ok: false, error: "value ต้องเป็น true/false" }, { status: 400 });
  }

  try {
    await setNotifySetting(key, body.value);
    return NextResponse.json({ ok: true, settings: await loadNotifySettings() });
  } catch (err) {
    console.error("[api/settings]", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
