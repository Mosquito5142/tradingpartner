import type { HourRow } from "@/lib/types";
import { Flag } from "./ui";

function heat(score: number): string {
  if (score >= 10) return "bg-[#3d7a56]";
  if (score >= 7) return "bg-[#2a5145]";
  if (score >= 4.5) return "bg-[#1f3b39]";
  if (score > 0) return "bg-[#1d2a2a]";
  return "bg-raise";
}

export function HourStrip({ rows }: { rows: HourRow[] }) {
  return (
    <div className="grid grid-cols-12 gap-0.5 sm:grid-cols-24">
      {rows.map((row) => {
        const hot = row.events.some((e) => e.volatile);
        const tip = [
          `${String(row.hour).padStart(2, "0")}:00 · ${row.session} · แกว่งเฉลี่ย $${row.vol.toFixed(2)}/แท่ง`,
          ...row.events.slice(0, 4).map((e) => `${e.time} ${e.title}`),
        ].join(" · ");
        return (
          <div
            key={row.hour}
            title={tip}
            className={`relative flex h-10 items-end justify-center rounded-[3px] pb-0.5 sm:h-11 ${heat(row.score)} ${
              row.isPast ? "opacity-40" : ""
            } ${row.isNow ? "outline outline-2 -outline-offset-1 outline-gold" : ""}`}
          >
            <span className={`tnum text-[9.5px] ${row.score >= 7 ? "text-[#dff3e6]" : "text-muted"}`}>
              {String(row.hour).padStart(2, "0")}
            </span>
            {row.events.length > 0 && (
              <span
                className={`absolute top-1 h-[5px] w-[5px] rounded-full ${
                  hot ? "bg-gold shadow-[0_0_5px_#f0b429]" : "bg-[#8fb6ef]"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TopWindows({ windows }: { windows: HourRow[] }) {
  if (!windows.length) {
    return <p className="text-[13px] text-faint">วันนี้ไม่มีช่วงเวลาที่เด่นเหลืออยู่แล้ว</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {windows.map((w) => (
        <div
          key={w.hour}
          className={`rounded-lg border border-line bg-card px-3 py-2.5 border-l-[3px] ${
            w.score >= 10 ? "border-l-[#3d7a56]" : w.score >= 7 ? "border-l-[#2a5145]" : "border-l-[#3a4354]"
          }`}
        >
          <div className="flex items-center justify-between text-[14px] font-semibold">
            <span className="tnum">
              {String(w.hour).padStart(2, "0")}:00 – {String(w.hour).padStart(2, "0")}:59 น.
            </span>
            <span className="text-[11px] font-bold text-gold">{w.score}</span>
          </div>
          <div className="mb-1 text-[11.5px] text-faint">
            {w.session} · เคยแกว่งเฉลี่ย ${w.vol.toFixed(2)} ต่อแท่ง 15 นาที
          </div>
          {w.events.length ? (
            w.events.slice(0, 4).map((e, i) => (
              <div key={i} className="py-px text-[12.5px] text-[#b9c0cc]">
                <b className="tnum text-text">{e.time}</b> <Flag country={e.country} /> {e.title}
                {e.volatile && " ⚡"}
              </div>
            ))
          ) : (
            <div className="text-[12.5px] text-faint">
              ไม่มีข่าว — แรงจากสภาพคล่องช่วง{w.session}ล้วน ๆ
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
