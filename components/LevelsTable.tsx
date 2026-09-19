import type { Level } from "@/lib/types";

const KIND_TH: Record<string, string> = {
  pivot: "Pivot รายวัน",
  prev_high: "กรอบเมื่อวาน",
  prev_low: "กรอบเมื่อวาน",
  asia: "กรอบเอเชีย",
  round: "เลขกลม",
};

export default function LevelsTable({ levels, price }: { levels: Level[]; price: number }) {
  if (!levels.length) {
    return <p className="text-[13px] text-faint">คำนวณแนวรับแนวต้านไม่ได้ (ข้อมูลราคาไม่พอ)</p>;
  }

  const rows: React.ReactNode[] = [];
  let placed = false;

  const priceRow = (
    <tr key="now">
      <td
        colSpan={4}
        className="border-y border-[#3a3020] bg-[#1d2330] py-1 text-center text-[12.5px] text-gold"
      >
        ราคาปัจจุบัน <b className="tnum text-[14px]">{price.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b>
      </td>
    </tr>
  );

  for (const lv of levels) {
    if (!placed && lv.price < price) {
      rows.push(priceRow);
      placed = true;
    }
    const isRes = lv.side === "resistance";
    // ป้ายประเภทจะซ้ำกับชื่อระดับในกรณี swing จึงแสดงเฉพาะตอนที่บอกอะไรเพิ่ม
    const kind = lv.kind !== "swing" ? KIND_TH[lv.kind] : "";
    rows.push(
      <tr key={`${lv.price}-${lv.label}`} className="border-b border-raise align-top">
        <td className="px-1.5 py-1.5">
          <b className={`tnum text-[13.5px] ${isRes ? "text-down" : "text-up"}`}>
            {lv.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </b>
        </td>
        <td className="tnum whitespace-nowrap px-1.5 py-1.5 text-muted">
          {lv.distance > 0 ? "+" : ""}
          {lv.distance.toFixed(2)}
        </td>
        <td className="px-1.5 py-1.5">
          <span
            className={`mr-1 rounded px-1.5 py-px text-[10px] ${
              isRes ? "bg-[#2c1518] text-[#ff7a7f]" : "bg-[#10291c] text-[#5fd68e]"
            }`}
          >
            {isRes ? "แนวต้าน" : "แนวรับ"}
          </span>
          {lv.label}
          {lv.also && <span className="text-faint"> + {lv.also}</span>}
          {kind && <div className="text-[11px] text-faint">{kind}</div>}
        </td>
        <td
          className="whitespace-nowrap px-1.5 py-1.5 tracking-tighter text-gold"
          title={`น้ำหนัก ${lv.strength}`}
        >
          {"▮".repeat(Math.min(5, Math.max(1, Math.round(lv.strength / 3))))}
        </td>
      </tr>,
    );
  }
  if (!placed) rows.push(priceRow);

  return (
    <table className="w-full border-collapse text-[12.8px]">
      <thead>
        <tr className="border-b border-line text-left text-[11.5px] font-normal text-faint">
          <th className="px-1.5 py-1 font-normal">ระดับ</th>
          <th className="px-1.5 py-1 font-normal">ห่าง</th>
          <th className="px-1.5 py-1 font-normal">ที่มา</th>
          <th className="px-1.5 py-1 font-normal">น้ำหนัก</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}
