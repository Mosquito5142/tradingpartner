import BriefingCard from "@/components/BriefingCard";
import Chart, { type NewsMark } from "@/components/Chart";
import EventList, { type EventItem } from "@/components/EventList";
import { HourStrip, TopWindows } from "@/components/HourStrip";
import LevelsTable from "@/components/LevelsTable";
import RegimeBand from "@/components/RegimeBand";
import RiskCalculator from "@/components/RiskCalculator";
import { Banner, Panel } from "@/components/ui";
import { CONFIG, loadDashboard } from "@/lib/dashboard";
import { relativeDay, thDateTime, thFullDate, thParts, thTime, thaiPeriod } from "@/lib/time";

/** ข้อมูลตลาดเปลี่ยนตลอด — ดึงใหม่ทุก 5 นาที */
export const revalidate = 300;

export default async function Home() {
  const d = await loadDashboard();
  const today = thParts(d.now).dateKey;

  const items: EventItem[] = d.items.map(({ event, bias, title }) => {
    const p = thParts(event.ts);
    return {
      ts: event.ts,
      time: thTime(event.ts),
      dayKey: p.dateKey,
      dayLabel: thFullDate(event.ts),
      dayRelative: relativeDay(event.ts, d.now),
      isToday: p.dateKey === today,
      country: event.country,
      importance: event.importance,
      title,
      titleEn: event.title,
      period: thaiPeriod(event.period),
      forecast: event.forecast,
      previous: event.previous,
      actual: event.actual,
      why: bias.why,
      // แสดงคำอธิบายเต็มเฉพาะข่าวใหญ่ ที่เหลือเก็บเป็น tooltip กันหน้ารก
      showWhy: Boolean(bias.why) && (event.importance === 1 || bias.volatile),
      volatile: bias.volatile,
      kind: bias.kind,
      dirIfHigher: bias.dirIfHigher,
      outcome: bias.outcome,
      surprise: bias.surprise,
      past: event.ts < d.now,
    };
  });

  const newsMarks: NewsMark[] = d.items
    .filter(({ event, bias }) => thParts(event.ts).dateKey === today && (event.importance === 1 || bias.volatile))
    .map(({ event }) => ({ ts: event.ts, label: thTime(event.ts), past: event.ts < d.now }));

  const countries = [...new Set(d.items.map((i) => i.event.country))].sort();

  return (
    <div className="flex flex-col gap-5">
      {d.calendar.stale && (
        <Banner>
          ⚠️ ดึงปฏิทินจากแหล่งหลักไม่สำเร็จ — กำลังแสดงข้อมูลจากแหล่งสำรอง ({d.calendar.source})
        </Banner>
      )}

      <BriefingCard card={d.card} />

      {d.price ? (
        <Panel>
          <div className="mb-1 flex flex-wrap items-baseline gap-3">
            <h2 className="text-[17px] font-semibold">แผนวันนี้</h2>
            <span className="tnum text-[26px] font-bold text-gold">
              {d.price.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="text-[12px] text-faint">
              spot {d.price.spot ?? "—"}
              {d.price.brokerOffset
                ? ` · ปรับให้ตรงกราฟโบรกเกอร์แล้ว (${d.price.brokerOffset > 0 ? "+" : ""}${d.price.brokerOffset})`
                : " · ยังไม่ได้ตั้ง broker offset"}
              {" · อัปเดต "}
              {thDateTime(d.price.fetchedAt)} น.
            </span>
          </div>

          {!d.price.calibrated && (
            <div className="mb-2">
              <Banner>
                ⚠️ ดึงราคา spot ไม่ได้ จึงปรับฐานไม่ได้ — <b>ระดับราคาและแนวรับแนวต้านอาจคลาดเคลื่อนหลายสิบเหรียญ</b>{" "}
                ใช้ดูรูปทรงกราฟได้ แต่อย่าเอาตัวเลขไปตั้งออเดอร์
              </Banner>
            </div>
          )}

          <Chart bars={d.price.bars} levels={d.levels} news={newsMarks} price={d.price.price} />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-faint">
            แท่งเทียน 15 นาที 24 ชั่วโมงล่าสุด · เส้นประแดง = แนวต้าน · เขียว = แนวรับ ·
            เส้นฟ้าแนวตั้ง = เวลาข่าว · ราคาอ้างอิง {d.price.barSource} ปรับฐานด้วย spot จริง
            อาจต่างจากโบรกเกอร์ ±1–2 เหรียญ
            {d.price.errors.length > 0 && (
              <>
                {" · "}
                <span className="text-[#c0a060]">แหล่งที่ใช้ไม่ได้รอบนี้: {d.price.errors.join(" · ")}</span>
              </>
            )}
          </p>

          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-[14.5px] font-semibold text-[#c7cdd8]">วันนี้น่าเล่นกี่โมง</h3>
              <p className="mb-2.5 mt-0.5 max-w-[60ch] text-[12px] text-faint">
                ความเข้มของช่องคือ &ldquo;ชั่วโมงนั้นทองเคยแกว่งแรงแค่ไหนใน 60 วันที่ผ่านมา&rdquo;
                รวมกับน้ำหนักข่าวของวันนี้ · จุดฟ้า = มีข่าว
              </p>
              <div className="mb-3.5">
                <HourStrip rows={d.hours} />
              </div>
              <TopWindows windows={d.windows} />
            </div>

            <div>
              <h3 className="text-[14.5px] font-semibold text-[#c7cdd8]">แนวรับ / แนวต้าน จากกราฟ 15 นาที</h3>
              <p className="mb-2.5 mt-0.5 max-w-[60ch] text-[12px] text-faint">
                รวมจุดกลับตัวย้อนหลัง 10 วัน, Pivot รายวัน, กรอบเมื่อวาน/เอเชีย และเลขกลม
              </p>
              <LevelsTable levels={d.levels} price={d.price.price} />
            </div>
          </div>

          {/* วางไว้ใต้ตารางแนวโดยตรง — ตารางบอกว่าเส้นอยู่ตรงไหน แถบนี้บอกว่าตอนนี้เชื่อได้แค่ไหน */}
          <div className="mt-4">
            <RegimeBand regime={d.regime} />
          </div>

          <RiskCalculator
            defaults={{ type: "cent", balance: 1455.68, risk: 2 }}
            noise15={d.lab.noise15}
          />
        </Panel>
      ) : (
        <Banner>
          ดึงราคาไม่สำเร็จทั้ง PAXG และ GC=F — แสดงเฉพาะปฏิทินข่าว
          <span className="block text-[12px] opacity-80">
            ดูสาเหตุได้ที่ Vercel → Logs (โค้ดเขียน error ไว้ด้วย prefix <code>[price]</code>)
          </span>
        </Banner>
      )}

      <Panel>
        <h2 className="mb-3 text-[17px] font-semibold">
          ปฏิทินข่าว {CONFIG.daysAhead} วันข้างหน้า
          <span className="ml-2 text-[12px] font-normal text-faint">
            เวลาไทย (GMT+7) · {d.items.length} รายการ · แหล่งข้อมูล {d.calendar.source}
          </span>
        </h2>
        <EventList items={items} countries={countries} />
      </Panel>
    </div>
  );
}
