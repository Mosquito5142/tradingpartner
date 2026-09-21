"use client";

import { useEffect, useMemo, useState } from "react";
import { expectancy, HORIZONS_SHOWN, type SegmentExpectancy } from "@/lib/expectancy";

/**
 * "กินได้จริงไหม" — แปลง % ความแม่นเป็นกำไรต่อไม้หลังหักต้นทุน
 *
 * เป็น client component เพราะต้องปรับต้นทุนได้สด ๆ แต่ไม่ยิง API ซ้ำ:
 * เซิร์ฟเวอร์ส่งผลลัพธ์ดิบต่อไม้มาเป็น array (ไม่กี่สิบตัวเลข) แล้วคำนวณใหม่ในเครื่อง
 * ต้นทุนแค่เลื่อนค่าเฉลี่ยลงตรง ๆ การกระจายไม่เปลี่ยน จึงคำนวณซ้ำได้ถูกต้อง
 */

const STORAGE_KEY = "goldCost";
const SL_DISTANCES = [3, 5, 8, 10, 15, 20];

function Cell({ value, suffix = "" }: { value: number; suffix?: string }) {
  return (
    <b className={`tnum ${value > 0 ? "text-up" : value < 0 ? "text-down" : "text-muted"}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(2)}
      {suffix}
    </b>
  );
}

export default function ExpectancyPanel({ segments }: { segments: SegmentExpectancy[] }) {
  const [cost, setCost] = useState("0.50");
  const [loaded, setLoaded] = useState(false);

  // อ่านค่าที่เคยกรอกหลัง mount เท่านั้น — กัน hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setCost(saved);
    } catch {
      /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว) — ใช้ค่าเริ่มต้นไป */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, cost);
    } catch {
      /* เขียนไม่ได้ก็ไม่เป็นไร */
    }
  }, [cost, loaded]);

  const costNum = parseFloat(cost) || 0;

  const rows = useMemo(
    () =>
      segments.map((seg) => ({
        label: seg.label,
        maes: seg.maes,
        mfeP50: seg.mfeP50,
        mfeP80: seg.mfeP80,
        stats: HORIZONS_SHOWN.map((h) => ({ h, e: expectancy(seg.outcomes[h] ?? [], costNum) })),
      })),
    [segments, costNum],
  );

  if (!segments.length) {
    return <p className="text-[13px] text-faint">ยังไม่มีข้อมูลพอ</p>;
  }

  const main = rows[0];
  const at15 = main.stats.find((s) => s.h === 15)?.e;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11.5px] text-muted">
          ต้นทุนต่อออนซ์ — สเปรด + slippage ($)
          <input
            className="w-40 rounded-md border border-line2 bg-ink px-2 py-1.5 tnum text-[13.5px] text-text outline-none focus:border-[#3d6fb5]"
            type="number"
            step="0.05"
            min="0"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </label>
        <p className="max-w-[46ch] text-[11.8px] leading-relaxed text-faint">
          ไม่รู้ว่าโบรกฯ คิดเท่าไหร่ ให้ลองไล่ค่าดู — ตัวเลขทุกช่องด้านล่างหักต้นทุนนี้ออกแล้ว
          ช่อง <b className="text-[#c7cdd8]">ต้นทุนคุ้มทุน</b> คือเพดานที่ยังเท่าทุน ·
          <b className="text-[#c7cdd8]">ชนะ*</b> คือชนะหลังหักต้นทุนแล้ว จึงต่ำกว่า % ความแม่นในแผงข้างบน
          (ไม้ที่ชนะน้อยกว่าต้นทุนนับเป็นแพ้)
        </p>
      </div>

      {rows.map((seg) => (
        <div key={seg.label} className="mb-4 last:mb-0">
          <h3 className="mb-1.5 text-[14px] font-semibold text-[#c7cdd8]">{seg.label}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12.8px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] text-faint">
                  <th className="py-1.5 pr-3 font-normal">ออกที่</th>
                  <th className="py-1.5 pr-3 font-normal">n</th>
                  <th className="py-1.5 pr-3 font-normal">เฉลี่ย/ไม้</th>
                  <th className="py-1.5 pr-3 font-normal">มัธยฐาน</th>
                  <th className="py-1.5 pr-3 font-normal">ชนะ*</th>
                  <th className="py-1.5 pr-3 font-normal">ช่วงเชื่อมั่น 95%</th>
                  <th className="py-1.5 font-normal">ต้นทุนคุ้มทุน</th>
                </tr>
              </thead>
              <tbody>
                {seg.stats.map(({ h, e }) => (
                  <tr key={h} className="border-b border-raise">
                    <td className="tnum py-1.5 pr-3 whitespace-nowrap">{h} นาที</td>
                    <td className="tnum py-1.5 pr-3 text-faint">{e.n}</td>
                    <td className="tnum py-1.5 pr-3">
                      {e.enough ? <Cell value={e.mean} /> : <span className="text-faint">—</span>}
                    </td>
                    <td className="tnum py-1.5 pr-3">
                      {e.enough ? <Cell value={e.median} /> : <span className="text-faint">—</span>}
                    </td>
                    <td className="tnum py-1.5 pr-3 text-muted">{e.enough ? `${e.winRate}%` : "—"}</td>
                    <td className="tnum py-1.5 pr-3">
                      {e.enough ? (
                        <span className={e.positive ? "text-up" : "text-muted"}>
                          {e.ci[0].toFixed(2)} ถึง {e.ci[1].toFixed(2)}
                          {e.positive && <b> ✓</b>}
                        </span>
                      ) : (
                        <span className="text-faint">ตัวอย่างน้อยเกินสรุป</span>
                      )}
                    </td>
                    <td className="tnum py-1.5 text-muted">
                      {e.enough ? `$${e.breakEvenCost.toFixed(2)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="mt-4 border-t border-line pt-3">
        <h3 className="text-[14px] font-semibold text-[#c7cdd8]">
          SL แต่ละระยะโดนเขี่ยทิ้งกี่ % — {main.label} ใน 15 นาที
        </h3>
        <p className="mb-2 mt-0.5 text-[11.8px] text-faint">
          วัดจากระยะที่ราคาสวนทางไปไกลสุดก่อนจะไปถูกทาง (n={main.maes.length}) ·
          ยังไม่รวม slippage ตอนโดนชน ซึ่งช่วงข่าวจะแย่กว่านี้
          {main.mfeP50 !== null && (
            <> · ฝั่งกำไรไปถึงมัธยฐาน ${main.mfeP50.toFixed(2)}</>
          )}
          {main.mfeP80 !== null && <> · เปอร์เซ็นไทล์ 80 ${main.mfeP80.toFixed(2)}</>}
        </p>
        <div className="flex flex-wrap gap-2">
          {SL_DISTANCES.map((d) => {
            const hit = main.maes.length
              ? Math.round((main.maes.filter((m) => m >= d).length / main.maes.length) * 100)
              : null;
            return (
              <div
                key={d}
                className="rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px]"
              >
                <span className="text-faint">SL </span>
                <b className="tnum">${d}</b>
                <span className="text-faint"> → โดนชน </span>
                <b className={`tnum ${hit !== null && hit >= 40 ? "text-down" : "text-muted"}`}>
                  {hit === null ? "—" : `${hit}%`}
                </b>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 rounded-md border border-[#3a3020] bg-[#221d12] px-3 py-2 text-[12.3px] leading-relaxed text-[#c0a060]">
        <b>สามข้อที่ต้องอ่านคู่กับตารางเสมอ:</b>
        <br />
        1. ตัวอย่างยังน้อย (n={at15?.n ?? 0} ที่ 15 นาทีของกลุ่มแรก) ช่วงความเชื่อมั่นจึงกว้างมาก —
        เครื่องหมาย ✓ ขึ้นเฉพาะตอนที่ <b>ขอบล่างของช่วงยังบวก</b> เท่านั้น ไม่ใช่แค่ค่าเฉลี่ยบวก
        <br />
        2. ถ้าค่าเฉลี่ยห่างจากมัธยฐานมาก แปลว่า <b>กำไรมาจากไม้ใหญ่ไม่กี่ไม้</b> ไม่ใช่กำไรสม่ำเสมอ —
        คนที่เก็บกำไรเร็วทุกไม้จะไม่ได้ขอบได้เปรียบนี้เลย
        <br />
        3. ตัวเลขนี้คิดจากราคากลาง <b>ไม่ได้รวม slippage ตอนตลาดกระชาก</b> ซึ่งช่วงข่าวมีจริง
        และมักแย่กว่าสเปรดที่โบรกฯ โชว์ไว้ — ของจริงจะต่ำกว่านี้
      </div>
    </div>
  );
}
