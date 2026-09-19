"use client";

import { useEffect, useState } from "react";

/**
 * นับถอยหลังสด
 *
 * เริ่มจากค่าว่างแล้วค่อยเติมหลัง mount — กัน hydration mismatch เพราะเวลาบนเซิร์ฟเวอร์
 * กับบนเครื่องผู้ใช้ไม่มีทางตรงกันพอดี
 */
export default function Countdown({ ts, className = "" }: { ts: number; className?: string }) {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const left = ts - Math.floor(Date.now() / 1000);
      if (left <= 0) {
        setText("ประกาศแล้ว — รีเฟรชเพื่อดูผลจริง");
        return;
      }
      const d = Math.floor(left / 86400);
      const h = Math.floor((left % 86400) / 3600);
      const m = Math.floor((left % 3600) / 60);
      const s = left % 60;
      const parts: string[] = [];
      if (d) parts.push(`${d} วัน`);
      if (d || h) parts.push(`${h} ชม.`);
      parts.push(`${m} นาที`, `${s} วิ`);
      setText(`อีก ${parts.join(" ")}`);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [ts]);

  return (
    <div className={`tnum text-gold ${className}`} suppressHydrationWarning>
      {text || " "}
    </div>
  );
}
