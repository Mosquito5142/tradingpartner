import { Banner, Panel } from "@/components/ui";
import { isConfigured } from "@/lib/db";
import { allRecords, MIN_SAMPLE, statsFor, summarize } from "@/lib/reactions";
import { thShortDate } from "@/lib/time";
import type { DecayPoint } from "@/lib/types";

export const revalidate = 300;

export const metadata = {
  title: "Reaction Lab — ทฤษฎีว่าอย่างนี้ ของจริงเป็นแบบนี้",
};

function CurveTable({ curve }: { curve: DecayPoint[] }) {
  if (!curve.length) return <p className="text-[13px] text-faint">ยังไม่มีข้อมูลพอ</p>;
  const peak = Math.max(...curve.map((c) => c.accuracy));
  return (
    <table className="w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-b border-line text-left text-[11.5px] text-faint">
          <th className="py-1 pr-2 font-normal">หลังข่าว</th>
          <th className="py-1 pr-2 font-normal">ทฤษฎีถูก</th>
          <th className="py-1 pr-2 font-normal">ขยับมัธยฐาน</th>
          <th className="py-1 font-normal">n</th>
        </tr>
      </thead>
      <tbody>
        {curve.map((c) => (
          <tr key={c.minutes} className="border-b border-raise">
            <td className="tnum py-1.5 pr-2 whitespace-nowrap">{c.minutes} นาที</td>
            <td className="py-1.5 pr-2">
              <div className="flex items-center gap-2">
                <b className={`tnum ${c.accuracy >= 60 ? "text-up" : c.accuracy <= 45 ? "text-down" : "text-muted"}`}>
                  {c.accuracy}%
                </b>
                <span
                  className="h-1.5 rounded-full bg-[#2a5145]"
                  style={{ width: `${(c.accuracy / Math.max(peak, 1)) * 84}px` }}
                />
              </div>
            </td>
            <td className="tnum py-1.5 pr-2">{c.medianMove !== null ? `$${c.medianMove}` : "—"}</td>
            <td className="tnum py-1.5 text-faint">{c.n}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function LabPage() {
  const records = await allRecords();
  const lab = summarize(records, isConfigured());

  if (!lab.configured) {
    return (
      <Panel title="Reaction Lab">
        <Banner tone="soft">
          ยังไม่ได้ตั้งค่าฐานข้อมูล — ใส่ <code className="text-[#c7cdd8]">TURSO_DATABASE_URL</code> และ{" "}
          <code className="text-[#c7cdd8]">TURSO_AUTH_TOKEN</code> ใน environment variables
          แล้วเรียก <code className="text-[#c7cdd8]">/api/collect</code> เพื่อเริ่มเก็บข้อมูล
        </Banner>
      </Panel>
    );
  }

  if (!lab.total) {
    return (
      <Panel title="Reaction Lab">
        <Banner tone="soft">
          คลังยังว่าง — เรียก <code className="text-[#c7cdd8]">/api/collect?backfill=1</code> เพื่อเก็บข้อมูลย้อนหลัง
        </Banner>
      </Panel>
    );
  }

  const groups = lab.groups.filter((g) => g.n >= MIN_SAMPLE);

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="ทฤษฎีใน bias แม่นแค่ไหน เมื่อวัดกับราคาจริง"
        sub={
          <>
            วัดจากข่าวที่มีผลจริงเทียบคาดการณ์ {lab.total} รายการ (
            {lab.oldest ? thShortDate(lab.oldest) : "—"} – {lab.newest ? thShortDate(lab.newest) : "—"}) ·
            50% = เท่ากับเดาสุ่ม
          </>
        }
      >
        <CurveTable curve={lab.curve} />
        <p className="mt-3 rounded-md border border-[#3a3020] bg-[#221d12] px-3 py-2 text-[12.5px] leading-relaxed text-[#c0a060]">
          <b>ข้อสรุปสำคัญ:</b> กฎทิศทางใช้ได้จริง แต่มีอายุราว 15 นาที หลัง 30 นาทีความแม่นตกเหลือ
          ระดับเดาสุ่ม — ตรวจแล้วว่าไม่ใช่ผลของเทรนด์ขาขึ้น (เส้นฐานคือทองปิดบวก 51.2% ของทุกชั่วโมง)
        </p>
      </Panel>

      <Panel
        title="แยกตามกลุ่มข่าว"
        sub="ต้องดู % ถูก คู่กับระยะที่ขยับเสมอ — แม่นสูงแต่ขยับน้อย (ต่ำกว่า ~$5) แทบไม่เหลืออะไรหลังหักสเปรด"
      >
        <div className="grid gap-4 md:grid-cols-3">
          {lab.breakdown.map((seg) => (
            <div key={seg.label} className="rounded-lg border border-line bg-card p-3">
              <h3 className="mb-2 text-[14px] font-semibold">
                {seg.label} <span className="text-[11.5px] font-normal text-faint">n={seg.n}</span>
              </h3>
              <CurveTable curve={seg.curve} />
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="สถิติรายข่าว"
        sub={`แสดงเฉพาะข่าวที่เก็บได้ตั้งแต่ ${MIN_SAMPLE} ครั้งขึ้นไป — น้อยกว่านั้นตัวเลขยังไม่มีความหมาย`}
      >
        {groups.length === 0 ? (
          <p className="text-[13px] text-faint">
            ยังไม่มีข่าวไหนเก็บครบ {MIN_SAMPLE} ครั้ง — เก็บข้อมูลต่อไปอีกสักพัก
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-[12.8px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] text-faint">
                  <th className="py-1.5 pr-3 font-normal">ข่าว</th>
                  <th className="py-1.5 pr-3 font-normal">n</th>
                  <th className="py-1.5 pr-3 font-normal">15 นาที ถูก</th>
                  <th className="py-1.5 pr-3 font-normal">ขยับ</th>
                  <th className="py-1.5 font-normal">3 ครั้งล่าสุด (15 นาที)</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(({ key }) => {
                  const s = statsFor(records, key);
                  const at15 = s.curve.find((c) => c.minutes === 15);
                  return (
                    <tr key={key} className="border-b border-raise align-top">
                      <td className="py-2 pr-3">{key}</td>
                      <td className="tnum py-2 pr-3 text-faint">{s.n}</td>
                      <td className="py-2 pr-3">
                        <b className={`tnum ${(at15?.accuracy ?? 50) >= 60 ? "text-up" : (at15?.accuracy ?? 50) <= 45 ? "text-down" : "text-muted"}`}>
                          {at15 ? `${at15.accuracy}%` : "—"}
                        </b>
                      </td>
                      <td className="tnum py-2 pr-3">{at15?.medianMove !== null && at15 ? `$${at15.medianMove}` : "—"}</td>
                      <td className="py-2">
                        {s.recent
                          .filter((r) => r.m15 !== null)
                          .map((r, i) => (
                            <span key={i} className="mr-1.5 inline-block rounded border border-line bg-raise px-1.5 py-px">
                              <i className="mr-1 not-italic text-faint">{r.date}</i>
                              <b className={`tnum ${r.m15! > 0 ? "text-up" : "text-down"}`}>
                                {r.m15! > 0 ? "+" : ""}
                                {r.m15!.toFixed(2)}
                              </b>
                            </span>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[12px] leading-relaxed text-faint">
        <b className="text-[#c0a060]">วิธีวัด:</b> เทียบราคาปิดของแท่ง 5 นาทีก่อนข่าว กับราคาปิดที่
        +5/+10/+15/+30/+60 นาที แล้วดูว่าทิศตรงกับที่กฎใน bias ทำนายไว้ไหม — ใช้ GC=F (ทองล่วงหน้า COMEX)
        เพราะเป็นตลาดจริงที่ข่าววิ่งเข้า และเราวัดแค่ส่วนต่าง ระดับราคาจึงไม่สำคัญ ·
        คลังเก็บสะสมถาวร ไม่ลบของเก่า ยิ่งใช้นานสถิติรายข่าวยิ่งเชื่อถือได้
      </p>
    </div>
  );
}
