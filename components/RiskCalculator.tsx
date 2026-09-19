"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * เครื่องคำนวณขนาดล็อต — รองรับบัญชี Cent
 *
 * สูตรตรวจสอบกับบัญชีจริงแล้ว (ขาย 0.40 ล็อต ระยะ 10.862 -> 434.48 USC):
 *   กำไร/ขาดทุน (หน่วยของบัญชี) = ระยะราคา($) × ล็อต × 100
 *
 * บัญชี Cent ยอดเงินเป็น USC และ P&L ก็เป็น USC
 * -> คณิตศาสตร์ %เสี่ยงเหมือนบัญชีปกติทุกประการ ต่างแค่มูลค่าเงินจริง = USC ÷ 100
 *
 * *** เป็นเครื่องคิดเลข ไม่ใช่คำแนะนำว่าควรเสี่ยงเท่าไร ***
 */

const STORAGE_KEY = "goldRisk";
const CONTRACT = 100; // 1 ล็อต = 100 ออนซ์

interface Inputs {
  type: "cent" | "std";
  balance: string;
  risk: string;
  sl: string;
  lot: string;
}

export default function RiskCalculator({
  defaults,
  noise15,
}: {
  defaults: { type: "cent" | "std"; balance: number; risk: number };
  noise15: number | null;
}) {
  const [v, setV] = useState<Inputs>({
    type: defaults.type,
    balance: String(defaults.balance),
    risk: String(defaults.risk),
    sl: "10",
    lot: "0.40",
  });
  const [loaded, setLoaded] = useState(false);
  const noise = noise15 ?? 8.9;

  // อ่านค่าที่เคยกรอกหลัง mount เท่านั้น — กัน hydration mismatch
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setV((cur) => ({ ...cur, ...JSON.parse(saved) }));
    } catch {
      /* localStorage ใช้ไม่ได้ (โหมดส่วนตัว) — ใช้ค่าเริ่มต้นไป */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch {
      /* เขียนไม่ได้ก็ไม่เป็นไร */
    }
  }, [v, loaded]);

  const calc = useMemo(() => {
    const isCent = v.type === "cent";
    const unit = isCent ? "USC" : "USD";
    const balance = parseFloat(v.balance) || 0;
    const riskPct = parseFloat(v.risk) || 0;
    const sl = parseFloat(v.sl) || 0;
    const lotIn = parseFloat(v.lot) || 0;

    const riskAmount = (balance * riskPct) / 100;
    const lot = sl > 0 ? riskAmount / (sl * CONTRACT) : 0;

    const backAmount = sl * lotIn * CONTRACT;
    const backPct = balance > 0 ? (backAmount / balance) * 100 : 0;

    const notes: string[] = [];
    if (sl > 0 && sl < noise) {
      notes.push(
        `SL $${sl.toFixed(2)} แคบกว่าระยะแกว่งปกติช่วงข่าว ($${noise.toFixed(2)} ใน 15 นาที) — มีโอกาสโดนชนก่อนราคาไปทางที่คิด`,
      );
    }
    if (backPct >= 10) {
      notes.push(`ล็อต ${lotIn} กับ SL $${sl.toFixed(2)} คิดเป็น ${backPct.toFixed(1)}% ของพอร์ตในไม้เดียว`);
    }

    const real = (n: number) => (isCent ? ` (= $${(n / 100).toFixed(2)} จริง)` : "");
    return {
      unit,
      lot: sl > 0 ? lot.toFixed(3) : "—",
      money: `${riskAmount.toFixed(2)} ${unit}${real(riskAmount)}`,
      back: `${backAmount.toFixed(2)} ${unit}${real(backAmount)} = ${backPct.toFixed(1)}% ของพอร์ต`,
      notes,
    };
  }, [v, noise]);

  const field = "w-full rounded-md border border-line2 bg-ink px-2 py-1.5 text-[13.5px] tnum text-text outline-none focus:border-[#3d6fb5]";
  const label = "flex flex-col gap-1 text-[11.5px] text-muted";

  return (
    <div className="mt-4 border-t border-line pt-3.5">
      <h3 className="text-[14.5px] font-semibold text-[#c7cdd8]">คำนวณขนาดล็อต</h3>
      <p className="mb-2.5 mt-0.5 max-w-[60ch] text-[12px] text-faint">
        กรอกยอดเงินกับความเสี่ยงที่รับได้ แล้วดูว่าได้ขนาดล็อตเท่าไร — เป็นเครื่องคิดเลข
        ไม่ใช่คำแนะนำว่าควรเสี่ยงเท่าไร
      </p>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={label}>
          ประเภทบัญชี
          <select
            className={field}
            value={v.type}
            onChange={(e) => setV({ ...v, type: e.target.value as Inputs["type"] })}
          >
            <option value="cent">Cent (USC)</option>
            <option value="std">Standard (USD)</option>
          </select>
        </label>
        <label className={label}>
          ยอดเงินในบัญชี
          <input className={field} type="number" step="0.01" value={v.balance}
                 onChange={(e) => setV({ ...v, balance: e.target.value })} />
        </label>
        <label className={label}>
          ความเสี่ยงต่อไม้ (%)
          <input className={field} type="number" step="0.1" value={v.risk}
                 onChange={(e) => setV({ ...v, risk: e.target.value })} />
        </label>
        <label className={label}>
          ระยะ SL (ดอลลาร์ทอง)
          <input className={field} type="number" step="0.01" value={v.sl}
                 onChange={(e) => setV({ ...v, sl: e.target.value })} />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-line bg-card px-3.5 py-2.5">
        <div className="flex items-baseline gap-2.5">
          <span className="text-[12px] text-muted">ขนาดล็อตที่ได้</span>
          <b className="tnum text-[24px] text-gold">{calc.lot}</b>
        </div>
        <div className="text-[13px] text-[#b9c0cc]">
          เงินที่เสี่ยง <b className="tnum text-text">{calc.money}</b>
        </div>
      </div>

      <div className="mt-2.5 grid items-end gap-2.5 sm:grid-cols-2">
        <label className={label}>
          หรือคิดย้อนกลับ — ถ้าใช้ล็อตนี้
          <input className={field} type="number" step="0.01" value={v.lot}
                 onChange={(e) => setV({ ...v, lot: e.target.value })} />
        </label>
        <div className="text-[13px] text-[#b9c0cc]">
          = เสี่ยง <b className="tnum text-text">{calc.back}</b>
        </div>
      </div>

      {calc.notes.length > 0 && (
        <p className="mt-2 rounded-md border border-[#54331f] bg-[#2a1a12] px-2.5 py-1.5 text-[12px] leading-relaxed text-[#ffb38a]">
          {calc.notes.join(" · ")}
        </p>
      )}

      <p className="mt-2 text-[12px] text-faint">
        ช่วงข่าวใหญ่สหรัฐฯ ทองขยับมัธยฐาน <b className="tnum text-[#c7cdd8]">${noise.toFixed(2)}</b> ใน 15 นาที
        (วัดจากข้อมูลจริง) ใช้เทียบว่า SL ที่ตั้งไว้กว้างพอเกินโซนแกว่งปกติหรือยัง
      </p>
    </div>
  );
}
