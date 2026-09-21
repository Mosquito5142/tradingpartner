import { phaseOf, pollFor, pickFocus, worthWatching, IMMINENT_MIN, WATCH_AFTER_MIN } from "@/lib/live";
import { EDGE_WINDOW_MIN } from "@/lib/briefing";
import type { AnnotatedEvent } from "@/lib/types";

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

  const pass = out.filter((r) => r[1]).length;
  return new Response(
    out.map(([n, ok, d]) => `${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "   " + d}`).join("\n") +
      `\n\n${pass}/${out.length} ผ่าน\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
