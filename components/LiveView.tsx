"use client";

import { useEffect, useRef, useState } from "react";
import type { LivePhase, LiveState } from "@/lib/live";
import { Flag, Tag } from "./ui";

const SURPRISE_TH: Record<string, string> = {
  higher: "ออกสูงกว่าคาด",
  lower: "ออกต่ำกว่าคาด",
  inline: "ตรงตามคาด",
};

function hhmmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

function dayPart(sec: number): string {
  const d = Math.floor(sec / 86400);
  return d ? `${d} วัน ` : "";
}

const BAND: Record<LivePhase, { bg: string; border: string; text: string; label: string }> = {
  none: { bg: "bg-raise", border: "border-line", text: "text-muted", label: "ไม่มีข่าวใหญ่" },
  waiting: { bg: "bg-raise", border: "border-line2", text: "text-muted", label: "ยังไม่ถึงเวลา" },
  imminent: { bg: "bg-[#2a2210]", border: "border-[#6b551d]", text: "text-gold", label: "ใกล้ประกาศแล้ว" },
  edge: { bg: "bg-[#10291c]", border: "border-[#2c6b47]", text: "text-up", label: "อยู่ในหน้าต่างขอบได้เปรียบ" },
  cooled: { bg: "bg-[#241a1a]", border: "border-[#5b3434]", text: "text-[#c98b8b]", label: "หมดหน้าต่างแล้ว" },
};

/** แถบสถานะ + นาฬิกา — เป็นหัวใจของหน้านี้ */
function StatusBand({ state, left }: { state: LiveState; left: number }) {
  const b = BAND[state.phase];
  const edgeSec = (state.card?.edgeWindowMin ?? 15) * 60;

  if (state.phase === "none" || !state.card) {
    return (
      <div className={`rounded-xl border ${b.border} ${b.bg} px-4 py-5 text-center`}>
        <div className="text-[15px] text-muted">ไม่มีข่าวใหญ่ในช่วง 36 ชั่วโมงข้างหน้า</div>
        <div className="mt-1 text-[12.5px] leading-relaxed text-faint">
          หน้านี้จะขึ้นนาฬิกาเฉพาะข่าวที่เข้าเกณฑ์เดียวกับที่ใช้วัดสถิติ 71% เท่านั้น
          (ข่าวแรง · ข่าวใหญ่สหรัฐฯ · ข่าวที่กระทบทองโดยตรง) —
          ยอมให้หน้าว่างดีกว่าเอาสถิติของข่าวใหญ่ไปแปะกับข่าวเล็ก
        </div>
      </div>
    );
  }

  // หลังประกาศ: นับ "เวลาที่เหลือของขอบได้เปรียบ" ไม่ใช่นับถอยหลังถึงข่าว
  if (state.phase === "edge") {
    const remain = edgeSec + left; // left ติดลบหลังประกาศ
    const pct = Math.max(0, Math.min(100, (remain / edgeSec) * 100));
    return (
      <div className={`rounded-xl border ${b.border} ${b.bg} px-4 py-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={`text-[12.5px] font-semibold tracking-wide ${b.text}`}>
            ⏱ {b.label} · เหลืออีก
          </span>
          <span className="text-[12px] text-faint">
            ผ่านไป {Math.floor(-left / 60)} นาทีจาก {state.card.edgeWindowMin} นาที
          </span>
        </div>
        <div className={`tnum mt-0.5 text-[44px] font-bold leading-none ${b.text}`}>
          {hhmmss(remain)}
        </div>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[#0c1a12]">
          <div className="h-full rounded-full bg-upx transition-[width] duration-1000 ease-linear"
               style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-[#9fc9b0]">
          วัดจากข้อมูลจริง: กฎทิศทางแม่น <b>71%</b> ใน 10–15 นาทีแรก (ข่าวใหญ่สหรัฐฯ n=35)
          พอครบ 30 นาทีเหลือ ~50% เท่ากับเดาสุ่ม — นาฬิกาหมดเมื่อไหร่คือหมดเหตุผลเชิงสถิติที่จะเข้าใหม่
        </p>
      </div>
    );
  }

  if (state.phase === "cooled") {
    return (
      <div className={`rounded-xl border ${b.border} ${b.bg} px-4 py-4`}>
        <div className={`text-[12.5px] font-semibold tracking-wide ${b.text}`}>⏱ {b.label}</div>
        <div className={`mt-0.5 text-[26px] font-bold leading-tight ${b.text}`}>
          ผ่านมา {Math.floor(-left / 60)} นาทีแล้ว
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-[#c9a8a8]">
          เลย {state.card.edgeWindowMin} นาทีแรกไปแล้ว — จากสถิติ ความแม่นของกฎทิศทางตกลงมาระดับเดาสุ่ม
          การเข้าตอนนี้ไม่ได้ต่างจากเข้าตอนไม่มีข่าว
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${b.border} ${b.bg} px-4 py-4`}>
      <div className={`text-[12.5px] font-semibold tracking-wide ${b.text}`}>
        {state.phase === "imminent" ? "🔔" : "🕒"} {b.label}
      </div>
      <div className={`tnum mt-0.5 text-[44px] font-bold leading-none ${b.text}`}>
        {dayPart(left)}
        {hhmmss(left % 86400)}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">
        {state.phase === "imminent"
          ? "พอประกาศ นาฬิกาจะสลับเป็นตัวนับหน้าต่างขอบได้เปรียบ 15 นาทีให้อัตโนมัติ"
          : `หน้านี้ดึงข้อมูลใหม่ทุก ${state.pollSec} วินาที และจะถี่ขึ้นเองเมื่อใกล้เวลา`}
      </p>
    </div>
  );
}

function MoveReadout({ state }: { state: LiveState }) {
  if (state.reference === null) return null;
  const moved = state.movedNow;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <div className="text-[11.5px] text-faint">ราคาก่อนประกาศ</div>
        <div className="tnum text-[19px] font-bold text-muted">{state.reference.toFixed(2)}</div>
      </div>
      <div>
        <div className="text-[11.5px] text-faint">ขยับไปแล้ว</div>
        <div
          className={`tnum text-[19px] font-bold ${
            moved === null ? "text-faint" : moved > 0 ? "text-up" : moved < 0 ? "text-down" : "text-muted"
          }`}
        >
          {moved === null ? "—" : `${moved > 0 ? "+" : ""}${moved.toFixed(2)}`}
        </div>
      </div>
      <div>
        <div className="text-[11.5px] text-faint">ทฤษฎีบอก</div>
        <div className="text-[19px] font-bold">
          {state.expected === "up" ? (
            <span className="text-up">▲ ขึ้น</span>
          ) : state.expected === "down" ? (
            <span className="text-down">▼ ลง</span>
          ) : state.expected === "neutral" ? (
            <span className="text-muted">— ตรงคาด</span>
          ) : (
            <span className="text-faint">รอตัวเลข</span>
          )}
        </div>
      </div>
      <div>
        <div className="text-[11.5px] text-faint">ตอนนี้ไปทางเดียวกันไหม</div>
        <div className="text-[19px] font-bold">
          {state.matchesTheory === null ? (
            <span className="text-faint">—</span>
          ) : state.matchesTheory ? (
            <span className="text-up">ตรงทฤษฎี</span>
          ) : (
            <span className="text-down">สวนทฤษฎี</span>
          )}
        </div>
      </div>
    </div>
  );
}

function EventList({
  title, sub, rows,
}: { title: string; sub?: string; rows: LiveState["upNext"] }) {
  if (!rows.length) return null;
  return (
    <div className="rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[12px] tracking-wide text-faint">{title}</div>
      {sub && <div className="mb-1.5 text-[11.5px] text-faint opacity-80">{sub}</div>}
      <ul className={`flex flex-col gap-1 ${sub ? "" : "mt-1.5"}`}>
        {rows.map((u) => (
          <li key={`${u.ts}-${u.title}`} className="flex items-baseline gap-2 text-[13px]">
            <span className="tnum w-12 shrink-0 text-muted">{u.time}</span>
            <Flag country={u.country} />
            <span className="text-[#c7cdd8]">{u.title}</span>
            {u.volatile && <Tag kind="vol">⚡</Tag>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function LiveView({ initial }: { initial: LiveState }) {
  const [state, setState] = useState(initial);
  const [left, setLeft] = useState(initial.secondsTo ?? 0);
  const busy = useRef(false);

  // นาฬิกาเดินทุกวินาทีบนเครื่องผู้ใช้ ไม่รอ poll — ไม่งั้นตัวเลขจะกระตุกทุก 15 วิ
  useEffect(() => {
    if (state.secondsTo === null) return;
    const target = state.card ? state.card.ts : 0;
    const tick = () => setLeft(target - Math.floor(Date.now() / 1000));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [state.secondsTo, state.card]);

  // ดึงข้อมูลใหม่ตามจังหวะที่เซิร์ฟเวอร์บอก (ถี่ขึ้นเองตอนใกล้ข่าว)
  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (busy.current || document.hidden) return;
      busy.current = true;
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const next = (await res.json()) as LiveState;
        if (alive && next.now) setState(next);
      } catch {
        // เน็ตหลุดชั่วคราวไม่ควรทำให้หน้าพัง — รอบหน้าค่อยลองใหม่
      } finally {
        busy.current = false;
      }
    };
    const t = setInterval(pull, state.pollSec * 1000);
    document.addEventListener("visibilitychange", pull);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", pull);
    };
  }, [state.pollSec]);

  const card = state.card;
  const released = state.secondsTo !== null && state.secondsTo <= 0;

  return (
    <div className="flex flex-col gap-4">
      <StatusBand state={state} left={left} />

      {card && (
        <div className="rounded-xl border border-line bg-card px-4 py-3.5">
          <div className="text-[19px] font-bold leading-snug">
            <Flag country={card.country} /> {card.title}
            {card.volatile && <Tag kind="vol">⚡ ผันผวนแรง</Tag>}
            {card.importance === 1 && <Tag kind="key">ข่าวใหญ่</Tag>}
          </div>
          <div className="text-[13px] text-[#b9c0cc]">
            {card.when} น. · <span className="text-faint">{card.titleEn}</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3">
            {[
              ["ครั้งก่อน", card.previous || "—", "text-muted"],
              ["คาดการณ์", card.forecast || "—", "text-muted"],
              [
                "ผลจริง",
                card.actual || (released ? "รอประกาศผล…" : "—"),
                card.actual ? "text-gold" : "text-faint",
              ],
            ].map(([k, v, cls]) => (
              <div key={k}>
                <div className="text-[11.5px] text-faint">{k}</div>
                <div className={`tnum text-[19px] font-bold ${cls}`}>{v}</div>
              </div>
            ))}
          </div>

          {card.actual && card.surprise && (
            <div className="mt-2 text-[13px] text-[#c7cdd8]">
              {SURPRISE_TH[card.surprise]} — {card.theory.why}
            </div>
          )}

          {released && (
            <div className="mt-3 border-t border-line pt-3">
              <MoveReadout state={state} />
            </div>
          )}

          <div className="mt-3 border-t border-line pt-3 text-[12.8px] leading-relaxed">
            <span className="text-[11.5px] text-faint">สถิติของจริงจากคลัง · </span>
            {card.history.toneEvent ? (
              <span className="text-[#7b8494]">
                ข่าวแถลงไม่มีตัวเลขให้เทียบ วัดความแม่นแบบนี้ไม่ได้ — ต้องฟังเนื้อหาเอง
              </span>
            ) : card.history.enough ? (
              <span className="text-[#c7cdd8]">
                ทฤษฎีถูก <b className="tnum">{card.history.accuracy15}%</b> ใน {card.edgeWindowMin} นาทีแรก
                (n={card.history.n})
                {card.history.medianMove15 ? (
                  <> · ขยับมัธยฐาน <b className="tnum">${card.history.medianMove15}</b></>
                ) : null}
                {card.history.medianRange60 ? (
                  <> · กรอบ 1 ชม. <b className="tnum">${card.history.medianRange60}</b></>
                ) : null}
              </span>
            ) : (
              <span className="text-[#7b8494]">
                {card.history.n
                  ? `เก็บได้ ${card.history.n} ครั้ง — ตัวอย่างยังน้อยเกินสรุป`
                  : "ยังไม่เคยเก็บข่าวตัวนี้"}
              </span>
            )}
          </div>

          {card.levels && (
            <div className="mt-2 text-[12.8px] text-[#c7cdd8]">
              <span className="text-[11.5px] text-faint">แนวใกล้ตัว · </span>
              {card.levels.resistance && (
                <>
                  แนวต้าน <b className="tnum text-down">{card.levels.resistance.price.toLocaleString()}</b>{" "}
                  <i className="not-italic text-faint">(+{card.levels.resistance.distance.toFixed(2)})</i>
                </>
              )}
              {card.levels.resistance && card.levels.support && " · "}
              {card.levels.support && (
                <>
                  แนวรับ <b className="tnum text-up">{card.levels.support.price.toLocaleString()}</b>{" "}
                  <i className="not-italic text-faint">({card.levels.support.distance.toFixed(2)})</i>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* หลักฐานข้อนี้ขัดกับสัญชาตญาณ จึงต้องเตือนตรงจุดที่ผู้ใช้กำลังจะใช้แนวรับต้านพอดี */}
      <div className="rounded-xl border border-[#54331f] bg-[#2a1a12] px-3.5 py-3 text-[12.3px] leading-relaxed text-[#ffb38a]">
        <b>ช่วงข่าวคือช่วงที่แนวรับแนวต้านใช้ไม่ได้</b> — จากการวัดเด้ง 458 ครั้ง:
        ตอนราคาพุ่งเข้าหาแนวเร็ว ๆ แบบช่วงข่าว เด้งแค่ <b>44.2%</b> (n=346)
        ส่วนตอนตลาดเงียบและราคาค่อย ๆ ไหลเข้า เด้ง <b>68.8%</b> (n=112)
        สองระบบนี้จึงต้องใช้คนละเวลา ไม่ใช่ใช้พร้อมกัน
      </div>

      <EventList title="ข่าวใหญ่ถัดไป" rows={state.upNext} />
      <EventList
        title="ข่าวเล็กในช่วงเดียวกัน"
        sub="ไม่เข้าเกณฑ์ให้จ้อง — แสดงไว้เพื่อให้รู้ว่ามีอะไรจะออกบ้าง"
        rows={state.minor}
      />

      <p className="text-[11.8px] leading-relaxed text-faint">
        ที่มาข้อมูล: {state.calendarSource}
        {state.barSource ? ` · แท่งเทียน ${state.barSource}` : ""} · ดึงซ้ำทุก {state.pollSec} วินาที
        {state.errors.length > 0 && (
          <span className="text-[#c98b8b]"> · มีแหล่งที่ดึงไม่ได้: {state.errors.join(" | ")}</span>
        )}
        <br />
        เวลาประกาศอาจถูกเลื่อนโดยหน่วยงานต้นทาง และช่วงข่าวสเปรดจะกว้างกับเกิด slippage ได้ —
        ตัวเลขทั้งหมดเป็นสถิติย้อนหลัง <b>ไม่ใช่คำแนะนำการลงทุน</b>
      </p>
    </div>
  );
}
