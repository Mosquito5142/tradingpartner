import { SHOCK_MOVE, type Behaviour } from "@/lib/behaviour";
import { thDateTime } from "@/lib/time";

/**
 * รูปแบบพฤติกรรม — สิ่งที่อ่านได้ตั้งแต่ไม้ไม่กี่ไม้
 *
 * แยกจากตารางผลงานโดยตั้งใจ เพราะคนละประเภทกัน:
 * ตรงนี้คือคำบรรยายสิ่งที่ทำไปแล้ว (เชื่อได้) ส่วนอัตราชนะรายกลุ่มคือการประมาณค่า (ยังเชื่อไม่ได้ที่ n น้อย)
 */

function Row({
  flagged, title, value, note,
}: {
  flagged: boolean;
  title: string;
  value: React.ReactNode;
  note: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5 border-b border-raise py-2.5 last:border-0">
      <span className={`mt-px shrink-0 text-[13px] ${flagged ? "text-down" : "text-up"}`}>
        {flagged ? "▲" : "✓"}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] text-[#c7cdd8]">
          <b>{title}</b> — {value}
        </div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-faint">{note}</div>
      </div>
    </li>
  );
}

export default function BehaviourPanel({
  b, balance, unit,
}: { b: Behaviour | null; balance: number; unit: string }) {
  if (!b) return <p className="text-[13px] text-faint">ยังไม่มีข้อมูล</p>;

  const pct = (amount: number) => (balance > 0 ? Math.abs(amount / balance) * 100 : null);
  const shockPct = pct(b.shockLoss);
  const worstPct = pct(b.worstLoss);
  const { reentry: re, hold, overlap: ov, concentration: con } = b;

  const revenge = re.ratio !== null && re.ratio >= 2;
  const thinProtection = b.withSl / b.n < 0.5;

  return (
    <div>
      <ul className="flex flex-col">
        <Row
          flagged={revenge}
          title="เข้าใหม่หลังแพ้ vs หลังชนะ"
          value={
            re.medianAfterLoss === null || re.medianAfterWin === null ? (
              <span className="text-faint">ยังมีไม้ต่อเนื่องไม่พอจะวัด</span>
            ) : (
              <>
                มัธยฐาน <b className="tnum">{re.medianAfterLoss} นาที</b> หลังแพ้ ·{" "}
                <b className="tnum">{re.medianAfterWin} นาที</b> หลังชนะ
                {re.ratio !== null && re.ratio > 1 && <> (เร็วกว่า {re.ratio} เท่า)</>}
              </>
            )
          }
          note={
            revenge
              ? "ตอนชนะรอได้ ตอนแพ้รีบกลับเข้า — เป็นลายเซ็นของการเทรดเอาคืน ซึ่งมักมาพร้อมขนาดไม้ที่ใหญ่ขึ้นด้วย"
              : "ไม่พบว่ารีบกลับเข้าหลังแพ้มากกว่าปกติ"
          }
        />

        <Row
          flagged={hold.cutsWinnersEarly}
          title="ระยะเวลาถือ"
          value={
            hold.winMedian === null || hold.lossMedian === null ? (
              <span className="text-faint">ยังมีทั้งไม้กำไรและขาดทุนไม่พอจะเทียบ</span>
            ) : (
              <>
                ไม้กำไรมัธยฐาน <b className="tnum">{hold.winMedian} นาที</b> · ไม้ขาดทุน{" "}
                <b className="tnum">{hold.lossMedian} นาที</b>
              </>
            )
          }
          note={
            hold.cutsWinnersEarly
              ? "ตัดกำไรเร็วกว่าที่ทนขาดทุน — สวนกับที่วัดได้ว่ากำไรเฉลี่ยมาจากไม้ใหญ่ไม่กี่ไม้ ถ้าเก็บเร็วทุกไม้จะไม่ได้ส่วนนั้น"
              : "ถือไม้กำไรนานกว่าไม้ขาดทุน ซึ่งเป็นทิศทางที่สอดคล้องกับการกระจายของกำไร"
          }
        />

        <Row
          flagged={ov.stacked > 0}
          title="ซ้อนไม้ทางเดียวกัน"
          value={
            ov.stacked === 0 ? (
              "ไม่มี — ถือทีละไม้ตลอด"
            ) : (
              <>
                <b className="tnum">{ov.stacked}</b> ไม้เปิดขณะยังมีไม้ทางเดียวกันค้างอยู่ · ถือรวมสูงสุด{" "}
                <b className="tnum">{ov.peakLots}</b> ล็อต
              </>
            )
          }
          note={
            ov.stacked === 0
              ? "ขนาดไม้ในรายงานคือความเสี่ยงจริง"
              : "ขนาดในรายงานเป็นต่อไม้ ไม่ใช่ความเสี่ยงจริง — เปิด 0.4 สองไม้พร้อมกันคือถือ 0.8 ล็อตในไอเดียเดียว"
          }
        />

        <Row
          flagged={con.flipsAt !== null && con.flipsAt <= 2}
          title="กำไรกระจุกที่กี่ไม้"
          value={
            con.flipsAt === null ? (
              <>ตัด 3 ไม้ที่ดีสุดออกแล้วยังเป็นบวก</>
            ) : (
              <>
                ตัด <b className="tnum">{con.flipsAt}</b> ไม้ที่ดีที่สุดออก แล้วพลิกเป็นขาดทุน
              </>
            )
          }
          note={
            <>
              {con.without.map((w) => (
                <span key={w.k} className="mr-2.5 inline-block">
                  ตัด {w.k} ไม้ →{" "}
                  <b className={`tnum ${w.net >= 0 ? "text-up" : "text-down"}`}>
                    {w.net >= 0 ? "+" : ""}
                    {w.net.toLocaleString()}
                  </b>
                </span>
              ))}
              <br />
              {con.flipsAt !== null && con.flipsAt <= 2
                ? "กำไรทั้งหมดมาจากไม้ไม่กี่ไม้ ไม่ใช่ผลของระบบที่ทำเงินสม่ำเสมอ"
                : "กำไรกระจายพอสมควร ไม่ได้พึ่งไม้ใดไม้หนึ่ง"}
            </>
          }
        />

        <Row
          flagged={thinProtection}
          title="ตั้ง SL / TP"
          value={
            <>
              SL <b className="tnum">{b.withSl}</b>/{b.n} ไม้ · TP <b className="tnum">{b.withTp}</b>/{b.n} ไม้
            </>
          }
          note={
            thinProtection
              ? "ไม้ส่วนใหญ่ไม่มีเพดานขาดทุน — ความเสี่ยงจริงของไม้พวกนั้นวัดไม่ได้เลย และ %เสี่ยงในตารางข้างบนจึงคำนวณให้ไม่ได้"
              : "ไม้ส่วนใหญ่มีเพดานขาดทุนกำหนดไว้"
          }
        />
      </ul>

      {ov.moments.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <div className="mb-1.5 text-[11.5px] text-faint">จังหวะที่ถือซ้อนกัน</div>
          <div className="flex flex-wrap gap-2">
            {ov.moments.map((m) => (
              <span
                key={`${m.ts}-${m.side}`}
                className="rounded-md border border-line bg-card px-2.5 py-1 text-[12px]"
              >
                <span className="tnum text-faint">{thDateTime(m.ts)}</span>{" "}
                <b className={m.side === "buy" ? "text-up" : "text-down"}>
                  {m.side === "buy" ? "Buy" : "Sell"}
                </b>{" "}
                <span className="tnum">
                  {m.count} ไม้ = {m.lots} ล็อต
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 rounded-md border border-[#54331f] bg-[#2a1a12] px-3 py-2 text-[12.3px] leading-relaxed text-[#ffb38a]">
        <b>เลขคณิตที่สำคัญกว่าทุกข้อข้างบน:</b> ขนาดที่ถือรวมสูงสุดคือ{" "}
        <b className="tnum">{ov.peakLots}</b> ล็อต ถ้าราคาสวน <b className="tnum">${SHOCK_MOVE}</b>{" "}
        จะขาดทุน{" "}
        <b className="tnum">
          {b.shockLoss.toLocaleString()} {unit}
        </b>
        {shockPct !== null && (
          <>
            {" "}
            = <b className="tnum">{shockPct.toFixed(0)}%</b> ของพอร์ต
          </>
        )}{" "}
        · ${SHOCK_MOVE} ไม่ใช่ตัวเลขสุดขั้ว — จากที่วัดช่วงข่าวใหญ่สหรัฐฯ ราคาสวนไปถึงระดับนี้ใน 10% ของครั้ง
        {worstPct !== null && (
          <>
            {" "}
            · ไม้แย่สุดที่เจอมาแล้วคือ{" "}
            <b className="tnum">
              {b.worstLoss.toLocaleString()} {unit}
            </b>{" "}
            = {worstPct.toFixed(1)}% ของพอร์ต
          </>
        )}
      </div>

      <p className="mt-2 text-[11.8px] leading-relaxed text-faint">
        ตัวเลขในแผงนี้เป็น <b className="text-[#c7cdd8]">คำบรรยายสิ่งที่ทำไปแล้ว</b> จึงอ่านได้ตั้งแต่ไม้ไม่กี่ไม้
        — ต่างจากอัตราชนะรายกลุ่มในตารางข้างล่าง ซึ่งเป็นการประมาณค่าและยังเชื่อไม่ได้ที่ n={b.n}
      </p>
    </div>
  );
}
