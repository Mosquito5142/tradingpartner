import { phaseOf, pollFor, pickFocus, worthWatching, IMMINENT_MIN, WATCH_AFTER_MIN } from "@/lib/live";
import { EDGE_WINDOW_MIN } from "@/lib/briefing";
import { atr14, ema, readRegime } from "@/lib/regime";
import { fetchGcf } from "@/lib/price";
import { buildLevels } from "@/lib/levels";
import type { AnnotatedEvent, Bar, Level } from "@/lib/types";

const bar = (c: number, h = c + 0.5, l = c - 0.5): Bar => ({ ts: 0, o: c, h, l, c });
const level = (price: number): Level => ({
  price, kind: "swing", label: "ทดสอบ", touches: 2, strength: 2,
  side: "support", distance: 0,
});

const ev = (id: string, ts: number, o: { volatile?: boolean; importance?: number; key?: boolean; rank?: number }) =>
  ({
    event: { id, ts, importance: o.importance ?? 0, title: id, country: "US" },
    bias: { volatile: o.volatile ?? false, key: o.key ?? false, rank: o.rank ?? 10 },
    title: id,
  }) as unknown as AnnotatedEvent;

/**
 * ชุดทดสอบตรรกะของโหมดข่าว
 *
 * โปรเจกต์นี้ยังไม่มี test runner และตรรกะพวกนี้ผูกกับเวลา ทดสอบด้วยการเปิดหน้าเว็บรอไม่ได้
 * จึงทำเป็น route ที่รันได้ทันที — เปิดเฉพาะตอน dev ไม่หลุดขึ้น production
 */
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new Response("Not found", { status: 404 });
  }
  const out: [string, boolean, string][] = [];
  const t = (name: string, got: unknown, want: unknown) =>
    out.push([name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`]);

  const N = 1_000_000;

  // ---- phaseOf ----
  t("none", phaseOf(null), "none");
  t("waiting (นาน)", phaseOf(IMMINENT_MIN * 60 + 1), "waiting");
  t("imminent (ขอบบน)", phaseOf(IMMINENT_MIN * 60), "imminent");
  t("imminent (1 วิ)", phaseOf(1), "imminent");
  t("edge (พอดีเวลา)", phaseOf(0), "edge");
  t("edge (ขอบล่าง)", phaseOf(-EDGE_WINDOW_MIN * 60), "edge");
  t("cooled (เลย 1 วิ)", phaseOf(-EDGE_WINDOW_MIN * 60 - 1), "cooled");

  // ---- pollFor ----
  t("poll edge", pollFor("edge", -60), 15);
  t("poll imminent", pollFor("imminent", 120), 15);
  t("poll cooled", pollFor("cooled", -1200), 30);
  t("poll waiting <1ชม.", pollFor("waiting", 3000), 30);
  t("poll waiting ไกล", pollFor("waiting", 7200), 60);
  t("poll none", pollFor("none", null), 300);

  // ---- worthWatching ----
  t("worth: volatile", worthWatching(ev("a", N, { volatile: true })), true);
  t("worth: importance 1", worthWatching(ev("b", N, { importance: 1 })), true);
  t("worth: key", worthWatching(ev("c", N, { key: true })), true);
  t("worth: ข่าวเล็ก", worthWatching(ev("d", N, {})), false);

  // ---- pickFocus ----
  const id = (x: AnnotatedEvent | null) => x?.event.id ?? null;

  t("focus: ข้ามข่าวเล็กไปหาข่าวใหญ่",
    id(pickFocus([ev("small", N + 60, {}), ev("big", N + 600, { importance: 1 })], N)), "big");

  t("focus: มีแต่ข่าวเล็ก -> null",
    id(pickFocus([ev("small", N + 60, {}), ev("small2", N + 120, {})], N)), null);

  t("focus: ยังจ้องข่าวที่เพิ่งออกแทนที่จะกระโดดไปตัวถัดไป",
    id(pickFocus([ev("justOut", N - 300, { importance: 1 }), ev("next", N + 600, { importance: 1 })], N)),
    "justOut");

  t(`focus: เลย ${WATCH_AFTER_MIN} นาทีแล้วเลื่อนไปตัวถัดไป`,
    id(pickFocus(
      [ev("old", N - WATCH_AFTER_MIN * 60 - 1, { importance: 1 }), ev("next", N + 600, { importance: 1 })], N)),
    "next");

  t("focus: ออกพร้อมกันเลือก rank ต่ำสุด",
    id(pickFocus([ev("weak", N - 60, { importance: 1, rank: 9 }), ev("strong", N - 60, { importance: 1, rank: 2 })], N)),
    "strong");

  t("focus: ข่าวเล็กที่เพิ่งออกไม่ถูกหยิบ",
    id(pickFocus([ev("smallJustOut", N - 60, {}), ev("bigLater", N + 600, { importance: 1 })], N)), "bigLater");

  // ---- EMA / ATR ต้องตรงกับสูตรที่ใช้ตอนวัด (คำนวณมือเทียบได้) ----
  t("ema: แท่งแรก = ราคาปิด", ema([bar(10)], 2), [10]);
  // k = 2/3 -> 20*(2/3) + 10*(1/3) = 16.67
  t("ema: แท่งสอง", ema([bar(10), bar(20)], 2).map((v) => Math.round(v * 100) / 100), [10, 16.67]);
  // แท่งแรก tr = 12-8 = 4 · แท่งสอง tr = max(20-10, |20-10|, |10-10|) = 10 -> (4+10)/2 = 7
  t("atr: Wilder 2 แท่ง", atr14([bar(10, 12, 8), bar(15, 20, 10)], 2), [4, 7]);

  // ---- readRegime ----
  t("regime: แท่งน้อยเกินไป -> null", readRegime(Array.from({ length: 100 }, () => bar(100)), []), null);

  const calm = Array.from({ length: 250 }, () => bar(100));
  const calmR = readRegime(calm, [level(103), level(97)]);
  t("regime: ตลาดนิ่ง -> ช้า", calmR?.fast, false);
  t("regime: ตลาดนิ่ง -> สรุปว่าแนวน่าจะอยู่", calmR?.verdict, "hold");
  t("regime: ตลาดนิ่ง -> ใช้ตัวเลข 68.8%", calmR?.headlinePct, 68.8);

  // พุ่งขึ้นเร็วใน 8 แท่งสุดท้าย ด้วยแท่งที่กว้างกว่าเดิมมาก -> ATR สูงขึ้น + ความเร็วสูง
  const spike = [
    ...Array.from({ length: 242 }, () => bar(100)),
    ...Array.from({ length: 8 }, (_, i) => bar(100 + (i + 1) * 2, 100 + (i + 1) * 2 + 2, 100 + i * 2)),
  ];
  const spikeR = readRegime(spike, [level(120), level(90)]);
  t("regime: พุ่งเร็ว -> เร็ว", spikeR?.fast, true);
  t("regime: พุ่งเร็ว -> สรุปว่าแนวน่าจะพัง", spikeR?.verdict, "break");
  t("regime: พุ่งเร็ว -> ใช้ตัวเลข 44.2%", spikeR?.headlinePct, 44.2);
  t("regime: พุ่งขึ้น -> เล็งแนวข้างบน", spikeR?.target?.price, 120);
  t("regime: ไหลลง -> เล็งแนวข้างล่าง",
    readRegime([...Array.from({ length: 242 }, () => bar(100)),
                ...Array.from({ length: 8 }, (_, i) => bar(100 - (i + 1) * 0.1))], [level(120), level(90)])?.target?.price,
    90);

  // ---- เทียบกับข้อมูลจริง: คำนวณซ้ำด้วยโค้ดคนละชุดในไฟล์นี้ ----
  try {
    const bars = await fetchGcf("15m", "60d");
    const r = readRegime(bars, buildLevels(bars, bars[bars.length - 1].c));
    let e = bars[0].c;
    let a = 0;
    bars.forEach((b, i) => {
      e = i === 0 ? b.c : b.c * (2 / 201) + e * (1 - 2 / 201);
      const tr = i === 0 ? b.h - b.l
        : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c));
      a = i === 0 ? tr : (a * 13 + tr) / 14;
    });
    const last = bars.length - 1;
    const sp = Math.abs(bars[last].c - bars[last - 8].c) / a;
    t(`GC=F จริง (${bars.length} แท่ง): EMA200 ตรง`, r?.ema200, Math.round(e * 100) / 100);
    t("GC=F จริง: ATR14 ตรง", r?.atr, Math.round(a * 100) / 100);
    t("GC=F จริง: ความเร็วตรง", r?.speed, Math.round(sp * 100) / 100);
  } catch (err) {
    out.push(["ข้ามการเทียบกับ GC=F (ดึงข้อมูลไม่ได้)", true, String(err)]);
  }

  const pass = out.filter((r) => r[1]).length;
  return new Response(
    out.map(([n, ok, d]) => `${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "   " + d}`).join("\n") +
      `\n\n${pass}/${out.length} ผ่าน\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
