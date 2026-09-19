import type { BriefingCard as Card } from "@/lib/briefing";
import Countdown from "./Countdown";
import { DirBadge, Flag, Tag } from "./ui";

const SURPRISE_TH: Record<string, string> = {
  higher: "ออกสูงกว่าคาด",
  lower: "ออกต่ำกว่าคาด",
  inline: "ตรงตามคาด",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-3 gap-y-0.5 py-0.5 text-[12.8px] sm:grid-cols-[150px_1fr]">
      <span className="text-[11.5px] text-faint">{label}</span>
      <span className="text-[#c7cdd8]">{children}</span>
    </div>
  );
}

function TheoryRow({ card }: { card: Card }) {
  if (card.kind === "tone") {
    return (
      <Row label="ทิศทางตามทฤษฎี">
        โทนผ่อนคลาย → <b className="text-up">▲ ทองขึ้น</b> · โทนเข้มงวด →{" "}
        <b className="text-down">▼ ทองลง</b>
      </Row>
    );
  }
  if (!card.theory.dirIfHigher) return null;
  const up = <b className="text-up">▲ ทองขึ้น</b>;
  const down = <b className="text-down">▼ ทองลง</b>;
  const isUp = card.theory.dirIfHigher === "up";
  return (
    <Row label="ทิศทางตามทฤษฎี">
      สูงกว่าคาด → {isUp ? up : down} · ต่ำกว่าคาด → {isUp ? down : up}
    </Row>
  );
}

function HistoryRow({ card }: { card: Card }) {
  const h = card.history;

  if (h.toneEvent) {
    return (
      <Row label="สถิติของจริง">
        <span className="text-[#7b8494]">
          ข่าวแถลงไม่มีตัวเลขให้เทียบ วัดความแม่นแบบนี้ไม่ได้ — ต้องฟังเนื้อหาเอง
        </span>
      </Row>
    );
  }

  // ตัวอย่างน้อยกว่า 3 ครั้งห้ามโชว์เปอร์เซ็นต์ เพราะบอกอะไรไม่ได้
  if (!h.enough) {
    return (
      <Row label="สถิติของจริง">
        <span className="text-[#7b8494]">
          {h.n ? `เก็บได้ ${h.n} ครั้ง — ตัวอย่างยังน้อยเกินสรุป` : "ยังไม่เคยเก็บข่าวตัวนี้"}
          {h.medianRange60 ? ` · กรอบ 1 ชม.ที่เคยเห็น $${h.medianRange60}` : ""}
        </span>
      </Row>
    );
  }

  return (
    <Row label="สถิติของจริง">
      ทฤษฎีถูก <b className="tnum text-text">{h.accuracy15}%</b> ใน {card.edgeWindowMin} นาทีแรก (n={h.n})
      {h.medianMove15 ? <> · ขยับมัธยฐาน <b className="tnum text-text">${h.medianMove15}</b></> : null}
      {h.medianRange60 ? <> · กรอบ 1 ชม. <b className="tnum text-text">${h.medianRange60}</b></> : null}
    </Row>
  );
}

function RecentRow({ card }: { card: Card }) {
  const recent = card.history.recent.filter((r) => r.m15 !== null);
  if (!recent.length) return null;
  return (
    <Row label={`ครั้งล่าสุด (${card.edgeWindowMin} นาทีแรก)`}>
      {recent.map((r, i) => (
        <span
          key={i}
          className="mr-1.5 inline-block rounded-[5px] border border-line bg-raise px-2 py-px text-[12px]"
        >
          <i className="mr-1.5 not-italic text-faint">{r.date}</i>
          {SURPRISE_TH[r.surprise] ?? ""} →{" "}
          <b className={`tnum ${r.m15! > 0 ? "text-up" : r.m15! < 0 ? "text-down" : "text-muted"}`}>
            {r.m15! > 0 ? "+" : ""}
            {r.m15!.toFixed(2)}
          </b>
        </span>
      ))}
    </Row>
  );
}

export default function BriefingCard({ card }: { card: Card | null }) {
  if (!card) {
    return (
      <div className="rounded-xl border border-line border-l-4 border-l-gold bg-card px-4 py-3.5">
        <div className="text-[12px] tracking-wide text-faint">ไม่มีข่าวในช่วงเวลาที่เลือก</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line border-l-4 border-l-gold bg-card px-4 py-3.5">
      <div className="text-[12px] tracking-wide text-faint">ข่าวใหญ่ตัวถัดไป</div>

      <div className="mt-0.5 text-[19px] font-bold leading-snug">
        <Flag country={card.country} /> {card.title}
        {card.volatile && <Tag kind="vol">⚡ ผันผวนแรง</Tag>}
        {card.importance === 1 && <Tag kind="key">ข่าวใหญ่</Tag>}
      </div>

      <div className="text-[13.5px] text-[#b9c0cc]">
        {card.when} น. · <span className="text-faint">{card.titleEn}</span>
      </div>

      <Countdown ts={card.ts} className="mt-1.5 text-[22px] font-bold" />

      <div className="mt-2.5 flex flex-col border-t border-line pt-2">
        {(card.forecast || card.previous) && (
          <Row label="ตัวเลข">
            {[
              card.forecast && (
                <span key="f">
                  คาดการณ์ <b className="tnum text-text">{card.forecast}</b>
                </span>
              ),
              card.previous && (
                <span key="p">
                  ครั้งก่อน <b className="tnum text-text">{card.previous}</b>
                </span>
              ),
            ]
              .filter(Boolean)
              .reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
          </Row>
        )}
        <TheoryRow card={card} />
        <HistoryRow card={card} />
        <RecentRow card={card} />
        {card.levels && (
          <Row label="แนวใกล้ตัว">
            {card.levels.resistance && (
              <>
                <b className="tnum text-down">{card.levels.resistance.price.toLocaleString()}</b>{" "}
                <i className="not-italic text-faint">(+{card.levels.resistance.distance.toFixed(2)})</i> แนวต้าน
              </>
            )}
            {card.levels.resistance && card.levels.support && " · "}
            {card.levels.support && (
              <>
                <b className="tnum text-up">{card.levels.support.price.toLocaleString()}</b>{" "}
                <i className="not-italic text-faint">({card.levels.support.distance.toFixed(2)})</i> แนวรับ
              </>
            )}
          </Row>
        )}
      </div>

      <div className="mt-2.5 rounded-md border border-[#3a3020] bg-[#221d12] px-2.5 py-1.5 text-[11.8px] leading-relaxed text-[#c0a060]">
        ขอบได้เปรียบของกฎทิศทางอยู่ราว 5–{card.edgeWindowMin} นาทีแรกเท่านั้น — วัดจากข้อมูลจริงพบว่า
        หลัง 30 นาทีความแม่นตกเหลือ ~50% เท่ากับเดาสุ่ม
      </div>
    </div>
  );
}
