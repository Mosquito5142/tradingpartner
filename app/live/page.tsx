import LiveView from "@/components/LiveView";
import { loadLive } from "@/lib/live";

/** ทั้งหน้าอยู่ได้เพราะความสด — ห้าม cache แล้วให้ client ดึงซ้ำเองตามจังหวะ */
export const dynamic = "force-dynamic";

export const metadata = { title: "โหมดข่าว — 15 นาทีที่มีขอบได้เปรียบ" };

export default async function LivePage() {
  const initial = await loadLive();
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[17px] font-semibold">โหมดข่าว</h1>
        <p className="text-[12.5px] leading-relaxed text-faint">
          หน้านี้โฟกัสเฉพาะช่วง 30 นาทีรอบข่าวใหญ่ เพราะเป็นช่วงเดียวที่วัดแล้วพบว่ากฎทิศทางได้ผลจริง
          — นาฬิกาจะสลับเป็นตัวนับถอยหลัง 15 นาทีให้เองตอนประกาศ แล้วหมดอายุเมื่อขอบได้เปรียบหมด
        </p>
      </div>
      <LiveView initial={initial} />
    </div>
  );
}
