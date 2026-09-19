"use client";

import { useMemo, useState } from "react";
import { COUNTRY_TH } from "@/lib/translate";
import { DirBadge, Flag, ImpactDot, Tag } from "./ui";

/** ข่าวหนึ่งรายการในรูปแบบที่ส่งข้ามจาก server component มาได้ */
export interface EventItem {
  ts: number;
  time: string;
  dayKey: string;
  dayLabel: string;
  dayRelative: string;
  isToday: boolean;
  country: string;
  importance: number;
  title: string;
  titleEn: string;
  period: string;
  forecast: string;
  previous: string;
  actual: string;
  why: string;
  showWhy: boolean;
  volatile: boolean;
  kind: string;
  dirIfHigher: string;
  outcome: string;
  surprise: string;
  past: boolean;
}

const SURPRISE_TH: Record<string, string> = {
  higher: "สูงกว่าคาด",
  lower: "ต่ำกว่าคาด",
  inline: "ตรงตามคาด",
};

const OUTCOME_TH: Record<string, [string, string]> = {
  up: ["ผลจริงหนุนทอง ▲", "bg-[#10291c] text-up"],
  down: ["ผลจริงกดดันทอง ▼", "bg-[#2c1518] text-down"],
  neutral: ["ออกตรงตามคาด ทองมักนิ่ง", "bg-raise text-muted"],
};

function BiasCell({ item }: { item: EventItem }) {
  if (item.kind === "tone") {
    return (
      <div className="flex flex-col gap-1 sm:items-end">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-faint">โทนผ่อนคลาย</span>
          <DirBadge dir="up">▲ ทองขึ้น</DirBadge>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] text-faint">โทนเข้มงวด</span>
          <DirBadge dir="down">▼ ทองลง</DirBadge>
        </div>
      </div>
    );
  }
  if (item.kind !== "number" || !item.dirIfHigher) {
    return (
      <div className="sm:text-right">
        <DirBadge dir="none">—</DirBadge>
      </div>
    );
  }
  const upFirst = item.dirIfHigher === "up";
  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-faint">สูงกว่าคาด</span>
        <DirBadge dir={upFirst ? "up" : "down"}>{upFirst ? "▲ ทองขึ้น" : "▼ ทองลง"}</DirBadge>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11.5px] text-faint">ต่ำกว่าคาด</span>
        <DirBadge dir={upFirst ? "down" : "up"}>{upFirst ? "▼ ทองลง" : "▲ ทองขึ้น"}</DirBadge>
      </div>
    </div>
  );
}

function Num({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <span className="flex justify-between gap-2 text-[12.5px]">
      <i className="not-italic text-faint">{label}</i>
      <b className={`tnum ${accent ? "text-gold" : ""}`}>{value}</b>
    </span>
  );
}

export default function EventList({ items, countries }: { items: EventItem[]; countries: string[] }) {
  const [impact, setImpact] = useState<"hi" | "key" | "all">("key");
  const [off, setOff] = useState<Set<string>>(new Set());

  const visible = useMemo(
    () =>
      items.filter((item) => {
        const okImpact =
          impact === "all" ? true : impact === "hi" ? item.importance === 1 : item.importance >= 0;
        return okImpact && !off.has(item.country);
      }),
    [items, impact, off],
  );

  const days = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const item of visible) {
      const list = map.get(item.dayKey) || [];
      list.push(item);
      map.set(item.dayKey, list);
    }
    return [...map.entries()];
  }, [visible]);

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-[13px] transition-colors ${
      on ? "border-[#3d6fb5] bg-[#22314a] text-[#dbe6f7]" : "border-line2 bg-raise text-muted hover:border-[#4a5567]"
    }`;

  const nowIndex = days.findIndex(([, list]) => list.some((i) => !i.past));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-faint">ความแรง</span>
        <button className={chip(impact === "hi")} onClick={() => setImpact("hi")}>เฉพาะข่าวใหญ่</button>
        <button className={chip(impact === "key")} onClick={() => setImpact("key")}>ข่าวใหญ่ + ปานกลาง</button>
        <button className={chip(impact === "all")} onClick={() => setImpact("all")}>ทั้งหมด</button>
        <span className="mx-1 h-5 w-px bg-line2" />
        <span className="text-[12.5px] text-faint">ประเทศ</span>
        {countries.map((c) => (
          <button
            key={c}
            className={chip(!off.has(c))}
            onClick={() =>
              setOff((cur) => {
                const next = new Set(cur);
                if (next.has(c)) next.delete(c);
                else next.add(c);
                return next;
              })
            }
          >
            <Flag country={c} /> {COUNTRY_TH[c] || c}
          </button>
        ))}
      </div>

      {days.length === 0 && (
        <p className="py-6 text-center text-[13px] text-faint">ไม่มีข่าวตามเงื่อนไขที่เลือก</p>
      )}

      {days.map(([dayKey, list], dayIdx) => (
        <div key={dayKey}>
          {dayIdx === nowIndex && nowIndex > 0 && (
            <div className="my-5 flex items-center gap-2.5 text-[12.5px] text-gold">
              <span className="h-px flex-1 bg-[#3a3020]" />
              <span className="whitespace-nowrap">ตอนนี้</span>
              <span className="h-px flex-1 bg-[#3a3020]" />
            </div>
          )}
          <section className="mb-5">
            <h2
              className={`mb-2 rounded-md border-l-[3px] bg-card px-3 py-1.5 text-[15.5px] font-semibold ${
                list[0].isToday ? "border-l-gold text-[#f5d78e]" : "border-l-[#3a4354] text-[#c7cdd8]"
              }`}
            >
              {list[0].dayLabel}{" "}
              <span className="ml-1.5 text-[13px] font-normal text-faint">{list[0].dayRelative}</span>
            </h2>

            {list.map((item) => (
              <div
                key={`${item.ts}-${item.titleEn}`}
                title={item.why}
                className={`grid items-start gap-3 border-b border-raise px-3 py-2.5 hover:bg-[#141922] sm:grid-cols-[72px_1fr_190px_180px] ${
                  item.past ? "opacity-45" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <b className="tnum text-[15.5px]">{item.time}</b>
                  <ImpactDot importance={item.importance} />
                </div>

                <div>
                  <div className="text-[14.8px]">
                    <Flag country={item.country} /> <b>{item.title}</b>{" "}
                    <span className="text-[12.5px] font-normal text-faint">{item.titleEn}</span>
                    {item.volatile && <Tag kind="vol">⚡ ผันผวนแรง</Tag>}
                    {item.importance === 1 && <Tag kind="key">ข่าวใหญ่</Tag>}
                  </div>
                  <div className="text-[12px] text-faint">
                    {[COUNTRY_TH[item.country] || item.country, item.period].filter(Boolean).join(" · ")}
                  </div>
                  {item.showWhy && (
                    <div className="mt-0.5 max-w-[62ch] text-[12.6px] text-[#98a2b3]">{item.why}</div>
                  )}
                  {item.outcome && OUTCOME_TH[item.outcome] && (
                    <span className={`mt-1 inline-block rounded px-2 py-px text-[12px] ${OUTCOME_TH[item.outcome][1]}`}>
                      {SURPRISE_TH[item.surprise] ?? ""} → {OUTCOME_TH[item.outcome][0]}
                    </span>
                  )}
                </div>

                <div className="flex flex-row flex-wrap gap-x-4 sm:flex-col sm:gap-0">
                  {item.forecast && <Num label="คาดการณ์" value={item.forecast} />}
                  {item.previous && <Num label="ครั้งก่อน" value={item.previous} />}
                  {item.actual && <Num label="ผลจริง" value={item.actual} accent />}
                  {!item.forecast && !item.previous && !item.actual && (
                    <span className="text-[12.5px] text-[#4a5567]">ไม่มีตัวเลข</span>
                  )}
                </div>

                <BiasCell item={item} />
              </div>
            ))}
          </section>
        </div>
      ))}
    </div>
  );
}
