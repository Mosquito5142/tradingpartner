"use client";

import { useState } from "react";
import type { NotifySettings } from "@/lib/settings";

/**
 * สวิตช์เปิด/ปิดการแจ้งเตือน Telegram
 *
 * อัปเดตหน้าจอทันทีแล้วค่อยยิง API — ถ้าเซิร์ฟเวอร์ปฏิเสธจะย้อนค่ากลับ
 * ไม่งั้นผู้ใช้จะเห็นสวิตช์ค้างรอทุกครั้งที่กด
 */

const LABELS: { key: keyof NotifySettings; title: string; note: string }[] = [
  {
    key: "news",
    title: "ก่อนข่าวใหญ่ 30 นาที",
    note: "เฉพาะข่าวที่เข้าเกณฑ์เดียวกับกลุ่มตัวอย่างที่วัดสถิติไว้",
  },
  {
    key: "regime",
    title: "สภาพตลาดรอบแนวรับแนวต้าน",
    note: "เมื่อราคาเข้าใกล้แนวภายใน 0.6 ATR · กันซ้ำด้วย cooldown 4 ชั่วโมง",
  },
];

function Switch({
  on, disabled, onToggle,
}: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
        on ? "border-[#2c6b47] bg-[#1f4a32]" : "border-line2 bg-raise"
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full transition-all ${
          on ? "left-[25px] bg-up" : "left-[3px] bg-[#8b94a3]"
        }`}
      />
    </button>
  );
}

export default function NotifyToggles({
  initial, configured,
}: { initial: NotifySettings; configured: boolean }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggle(key: keyof NotifySettings) {
    const next = !s[key];
    const before = s;
    setS({ ...s, [key]: next });
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: next }),
      });
      const j = await res.json();
      if (j.ok) setS(j.settings);
      else {
        setS(before);
        setError(j.error ?? "บันทึกไม่สำเร็จ");
      }
    } catch (e) {
      setS(before);
      setError(`บันทึกไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 border-b border-line pb-2.5">
        <div>
          <div className="text-[13.5px] font-semibold text-[#c7cdd8]">ส่งเข้า Telegram</div>
          <div className="text-[11.8px] text-faint">
            {configured
              ? s.enabled
                ? "เปิดอยู่ — ปิดสวิตช์นี้แล้วจะไม่ส่งอะไรเลย"
                : "ปิดอยู่ — ไม่ส่งอะไรทั้งนั้น"
              : "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID"}
          </div>
        </div>
        <Switch on={s.enabled} disabled={busy !== null} onToggle={() => toggle("enabled")} />
      </div>

      {LABELS.map(({ key, title, note }) => (
        <div
          key={key}
          className={`flex items-center justify-between gap-3 border-b border-raise py-2.5 last:border-0 ${
            s.enabled ? "" : "opacity-45"
          }`}
        >
          <div className="min-w-0">
            <div className="text-[13px] text-[#c7cdd8]">{title}</div>
            <div className="text-[11.8px] leading-relaxed text-faint">{note}</div>
          </div>
          <Switch
            on={s[key]}
            disabled={busy !== null || !s.enabled}
            onToggle={() => toggle(key)}
          />
        </div>
      ))}

      {error && (
        <p className="mt-2 rounded-md border border-[#54331f] bg-[#2a1a12] px-2.5 py-1.5 text-[12.5px] text-[#ffb38a]">
          {error}
        </p>
      )}

      <p className="mt-2 text-[11.8px] leading-relaxed text-faint">
        ค่านี้เก็บที่ฐานข้อมูล ไม่ใช่ในเบราว์เซอร์ — ตัวที่ส่งข้อความคือ cron ฝั่งเซิร์ฟเวอร์
        ถ้าเก็บในเครื่องจะปิดยังไงก็ยังส่งอยู่ดี
      </p>
    </div>
  );
}
