import type { Regime } from "@/lib/regime";
import { MEASURED } from "@/lib/regime";

const TONE = {
  hold: {
    border: "border-[#2c6b47]", bg: "bg-[#10291c]", text: "text-up",
    head: "สภาพตอนนี้เข้าทางการเด้ง",
  },
  break: {
    border: "border-[#5b3434]", bg: "bg-[#241a1a]", text: "text-[#ff9a9e]",
    head: "สภาพตอนนี้เข้าทางแนวพัง",
  },
  mixed: {
    border: "border-[#6b551d]", bg: "bg-[#2a2210]", text: "text-gold",
    head: "สัญญาณขัดกันเอง",
  },
} as const;

function Mark({ favors }: { favors: boolean | null }) {
  if (favors === null) return <span className="text-faint">•</span>;
  return favors ? <span className="text-up">✓</span> : <span className="text-down">✕</span>;
}

/**
 * แถบสภาพตลาด — ตอบคำถามที่ตารางแนวรับแนวต้านตอบไม่ได้
 * ว่าตอนนี้ "เส้นพวกนั้นน่าเชื่อแค่ไหน" ไม่ใช่แค่ "เส้นอยู่ตรงไหน"
 */
export default function RegimeBand({ regime }: { regime: Regime | null }) {
  if (!regime) return null;
  const t = TONE[regime.verdict];

  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} px-4 py-3.5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={`text-[15px] font-semibold ${t.text}`}>{t.head}</span>
        <span className="text-[12px] text-faint">
          เส้นฐาน: แนวรับต้านโดยรวมเด้ง {MEASURED.baseline.pct}% (n={MEASURED.baseline.n}) —
          เท่ากับเดาสุ่ม ตัวเส้นเองไม่มีขอบได้เปรียบ
        </span>
      </div>

      <p className={`mt-0.5 text-[13.5px] leading-relaxed text-[#c7cdd8]`}>
        ราคากำลังวิ่ง<b>{regime.approachUp ? "ขึ้น" : "ลง"}</b>
        {regime.target ? (
          <>
            {" "}เข้าหา{regime.target.side === "resistance" ? "แนวต้าน" : "แนวรับ"}{" "}
            <b className={`tnum ${regime.target.side === "resistance" ? "text-down" : "text-up"}`}>
              {regime.target.price.toLocaleString()}
            </b>{" "}
            <i className="not-italic text-faint">
              ({regime.target.distance > 0 ? "+" : ""}
              {regime.target.distance.toFixed(2)} · {regime.target.label})
            </i>
          </>
        ) : (
          " แต่ไม่มีแนวข้างหน้าในระยะที่คำนวณไว้"
        )}{" "}
        — สภาพแบบนี้ในอดีตเด้ง <b className={`tnum ${t.text}`}>{regime.headlinePct}%</b>
      </p>

      <ul className="mt-2.5 flex flex-col gap-1 border-t border-line pt-2">
        {regime.factors.map((f) => (
          <li key={f.label} className="grid gap-x-2 text-[12.5px] sm:grid-cols-[18px_150px_1fr_auto]">
            <Mark favors={f.favorsBounce} />
            <span className="text-faint">{f.label}</span>
            <span className="text-[#c7cdd8]">{f.value}</span>
            <span className="text-[11.8px] text-muted">{f.stat}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-[11.8px] leading-relaxed text-faint">
        ทดสอบไว้ ~12 เงื่อนไข ย่อมมีบางอันบังเอิญผ่านเกณฑ์ — คู่ <b>เร็ว/ช้า</b> เชื่อถือได้ที่สุด
        (สองฝั่งมีนัยคนละทิศ รวม n=458) จึงใช้ตัวนี้ตัดสิน ส่วนอีกสองปัจจัยถือเป็นข้อสังเกตประกอบ
        ไม่ได้เอามาคูณกันเพราะตัวอย่างไม่พอ · ตัวเลขวัดจาก GC=F 15 นาที 60 วัน
      </p>
    </div>
  );
}
