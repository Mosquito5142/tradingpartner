import { phaseOf, pollFor, pickFocus, worthWatching, IMMINENT_MIN, WATCH_AFTER_MIN } from "@/lib/live";
import { EDGE_WINDOW_MIN } from "@/lib/briefing";
import { atr14, ema, readRegime } from "@/lib/regime";
import { measure, MIN_SAMPLE } from "@/lib/reactions";
import { detectCurrency, parseAccount } from "@/lib/mt5-import";
import { equityCurve, lotProfile, wilson } from "@/lib/account";
import { fmtThb, supportsThb, toThb } from "@/lib/fx";
import { analyseBehaviour, concentration, holdSplit, overlaps, reentryGaps } from "@/lib/behaviour";
import type { Trade } from "@/lib/trades";
import {
  adverseExcursions, expectancy, favorableExcursions, percentile, signedOutcomes, stopOutRates,
} from "@/lib/expectancy";
import type { ReactionRecord } from "@/lib/types";
import { fetchGcf } from "@/lib/price";
import { buildLevels } from "@/lib/levels";
import { alertsFor, alreadySent, formatCard, isDue, LEAD_MIN, MIN_LEAD_MIN } from "@/lib/notify";
import { getDb, isConfigured } from "@/lib/db";
import type { AnnotatedEvent, Bar, Level } from "@/lib/types";
import type { BriefingCard } from "@/lib/briefing";

const card = (over: Partial<BriefingCard> = {}): BriefingCard => ({
  ts: 0, when: "21/09/2026 19:30", title: "การจ้างงานนอกภาคเกษตร", titleEn: "Non-Farm Payrolls",
  country: "US", importance: 1, volatile: true, kind: "number",
  forecast: "225K", previous: "218K", actual: "", surprise: "", outcome: "",
  theory: { dirIfHigher: "down", why: "จ้างงานดีเกินคาด → เฟดไม่ต้องรีบลดดอกเบี้ย → ทองลง" },
  edgeWindowMin: 15,
  history: { key: "NFP", n: 12, enough: true, accuracy15: 71, medianMove15: 8.9, medianRange60: 21.4, recent: [] },
  ...over,
});

const bar = (c: number, h = c + 0.5, l = c - 0.5): Bar => ({ ts: 0, o: c, h, l, c });

/** ไม้จำลอง — เวลาเป็นนาทีเพื่อให้อ่านเคสง่าย */
const trade = (o: Partial<Trade> & { openMin: number; closeMin?: number; profit: number }): Trade => ({
  ticket: `t${o.openMin}-${o.profit}-${o.side ?? "buy"}`,
  symbol: "XAUUSD", side: o.side ?? "buy", lots: o.lots ?? 0.4,
  openTs: o.openMin * 60,
  closeTs: o.closeMin === undefined ? null : o.closeMin * 60,
  openPrice: 4300, closePrice: 4300,
  sl: o.sl ?? null, tp: o.tp ?? null,
  profit: o.profit, commission: 0, swap: 0, comment: "",
  currency: "USC", sessionTag: "", newsTag: "",
  holdMin: o.closeMin === undefined ? null : o.closeMin - o.openMin,
  riskPct: null, rMultiple: null, source: "import",
});

/** แถวคลังจำลอง — ใส่เฉพาะช่องที่การทดสอบสนใจ */
const rec = (o: Partial<ReactionRecord>): ReactionRecord => ({
  id: "x", ts: 0, key: "k", title: "t", country: "US", importance: 1,
  surprise: "higher", pred: "up",
  m5: null, m10: null, m15: null, m30: null, m60: null, rng60: null,
  actualRaw: null, forecastRaw: null, surprisePct: null,
  up15: null, dn15: null, up60: null, dn60: null,
  ...o,
});
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

  // ---- หน้าต่างแจ้งเตือน ----
  t(`due: ${LEAD_MIN} นาทีพอดี`, isDue(N + LEAD_MIN * 60, N), true);
  t("due: ไกลเกินหน้าต่าง", isDue(N + (LEAD_MIN + 1) * 60, N), false);
  t(`due: ${MIN_LEAD_MIN} นาที (ขอบล่าง)`, isDue(N + MIN_LEAD_MIN * 60, N), true);
  t("due: สายเกินไปแล้ว", isDue(N + (MIN_LEAD_MIN - 1) * 60, N), false);
  t("due: ประกาศไปแล้ว", isDue(N - 60, N), false);

  // ---- ข้อความแจ้งเตือน ----
  const msg = formatCard(card(), 30);
  t("ข้อความ: บอกว่าเหลือกี่นาที", msg.includes("อีก 30 นาที"), true);
  t("ข้อความ: มีคาดการณ์/ครั้งก่อน", msg.includes("225K") && msg.includes("218K"), true);
  t("ข้อความ: ทิศทางตามทฤษฎีกลับข้างถูก",
    msg.includes("สูงกว่าคาด → ▼ ทองลง") && msg.includes("ต่ำกว่าคาด → ▲ ทองขึ้น"), true);
  t("ข้อความ: มีสถิติพร้อม n", msg.includes("71%") && msg.includes("n=12"), true);
  t("ข้อความ: เตือนเรื่องอายุขอบได้เปรียบ", msg.includes("15 นาทีแรกเท่านั้น"), true);
  t("ข้อความ: เตือนว่าไม่ใช่คำแนะนำการลงทุน", msg.includes("ไม่ใช่คำแนะนำการลงทุน"), true);

  const thin = formatCard(card({ history: { key: "x", n: 1, enough: false, accuracy15: null, medianMove15: null, medianRange60: null, recent: [] } }), 12);
  t("ข้อความ: n น้อยห้ามโชว์ %", thin.includes("ยังน้อยเกินสรุป") && !thin.includes("ทฤษฎีถูก"), true);

  const tone = formatCard(card({ kind: "tone", history: { key: "y", n: 0, enough: false, toneEvent: true, accuracy15: null, medianMove15: null, medianRange60: null, recent: [] } }), 30);
  t("ข้อความ: ข่าวแถลงบอกว่าวัดไม่ได้", tone.includes("วัดความแม่นแบบนี้ไม่ได้"), true);

  t("ข้อความ: หนี HTML ในชื่อข่าว",
    formatCard(card({ title: "<b>ทดสอบ</b> & ข่าว" }), 30).includes("&lt;b&gt;ทดสอบ&lt;/b&gt; &amp; ข่าว"), true);

  // ---- คัดข่าวที่จะเตือน (ข้อมูลจำลอง เพราะปฏิทินจริงอาจไม่มีข่าวใหญ่พอดี) ----
  const nev = (id: string, mins: number, o: Parameters<typeof ev>[2]) => ev(id, N + mins * 60, o);
  const picked = alertsFor(
    [
      nev("big", 20, { importance: 1 }),
      nev("vol", 25, { volatile: true }),
      nev("key", 28, { key: true }),
      nev("small", 20, {}),
      nev("tooFar", 90, { importance: 1 }),
      nev("tooLate", 2, { importance: 1 }),
      nev("past", -10, { importance: 1 }),
    ],
    [],
    N,
  );
  t("เตือน: เอาเฉพาะข่าวที่เข้าเกณฑ์และอยู่ในหน้าต่าง",
    picked.map((p) => p.eventId).sort(), ["big", "key", "vol"]);
  t("เตือน: id กันซ้ำผูกกับ event", picked.find((p) => p.eventId === "big")?.id, "big:pre");
  t("เตือน: นับนาทีที่เหลือถูก", picked.find((p) => p.eventId === "vol")?.minutesLeft, 25);
  t("เตือน: ไม่มีข่าวเข้าเกณฑ์ -> ว่าง", alertsFor([nev("small", 20, {})], [], N).length, 0);

  // ---- กันส่งซ้ำ (แตะฐานข้อมูลจริง แล้วลบทิ้ง) ----
  const db = getDb();
  if (isConfigured() && db) {
    const id = `tcheck-${Date.now()}:pre`;
    try {
      t("กันซ้ำ: ยังไม่เคยส่ง", (await alreadySent([id])).has(id), false);
      await db.execute({
        sql: "INSERT INTO alerts_sent (id, event_id, kind, event_ts) VALUES (?,?,?,?)",
        args: [id, "tcheck", "pre", 0],
      });
      t("กันซ้ำ: ส่งแล้วต้องเจอ", (await alreadySent([id])).has(id), true);
    } finally {
      await db.execute({ sql: "DELETE FROM alerts_sent WHERE id = ?", args: [id] });
    }
    t("กันซ้ำ: ลบข้อมูลทดสอบออกแล้ว", (await alreadySent([id])).has(id), false);
  }

  // ---- measure() เก็บระยะวิ่งสุดขีด ----
  // แท่งอ้างอิงปิด 100 · หลังข่าวแกว่ง 96-104 -> ขึ้นไกลสุด 4 ลงไกลสุด 4
  const mBars: Bar[] = [
    { ts: 0, o: 100, h: 100, l: 100, c: 100 },
    { ts: 300, o: 100, h: 104, l: 99, c: 103 },
    { ts: 600, o: 103, h: 103, l: 96, c: 97 },
  ];
  const m = measure(300, mBars);
  t("measure: ขึ้นไกลสุด 15 นาที", m?.up15, 4);
  t("measure: ลงไกลสุด 15 นาที", m?.dn15, 4);
  t("measure: ไม่ติดลบเมื่อราคาไปทางเดียว",
    (measure(300, [
      { ts: 0, o: 100, h: 100, l: 100, c: 100 },
      { ts: 300, o: 101, h: 105, l: 101, c: 104 },
    ])?.dn15 ?? -1) >= 0, true);

  // ---- signedOutcomes ----
  t("signed: pred=up ใช้ค่าตามจริง", signedOutcomes([rec({ m15: 8 })], 15), [8]);
  t("signed: pred=down กลับข้าง", signedOutcomes([rec({ pred: "down", m15: 8 })], 15), [-8]);
  t("signed: ข้ามแถวที่ทฤษฎีไม่ชี้ทิศ",
    signedOutcomes([rec({ pred: "neutral", m15: 8 }), rec({ pred: "", m15: 5 })], 15), []);
  t("signed: ข้ามแถวที่ไม่มีค่า", signedOutcomes([rec({ m15: null })], 15), []);

  // ---- expectancy (คำนวณมือได้) ----
  // [10,-5,3] ต้นทุน 1 -> สุทธิ [9,-6,2] เฉลี่ย 5/3 = 1.67 มัธยฐาน 2 ชนะ 2/3 = 67%
  const ex = expectancy([10, -5, 3], 1);
  t("expectancy: ค่าเฉลี่ยหลังหักต้นทุน", ex.mean, 1.67);
  t("expectancy: มัธยฐาน", ex.median, 2);
  t("expectancy: อัตราชนะ", ex.winRate, 67);
  t("expectancy: ต้นทุนคุ้มทุน = เฉลี่ยก่อนหัก", ex.breakEvenCost, 2.67);
  t("expectancy: หักด้วยต้นทุนคุ้มทุนแล้วเหลือศูนย์",
    Math.abs(expectancy([10, -5, 3], 2.666666666666667).mean) < 0.01, true);
  t("expectancy: ต้นทุนเลื่อนค่าเฉลี่ยลงตรง ๆ",
    Math.round((expectancy([10, -5, 3], 0).mean - ex.mean) * 100) / 100, 1);
  t("expectancy: SD ไม่เปลี่ยนตามต้นทุน", expectancy([10, -5, 3], 0).sd, ex.sd);
  t("expectancy: ไม่มีข้อมูล -> ไม่พัง", expectancy([], 1).n, 0);
  t(`expectancy: n < ${MIN_SAMPLE} ห้ามสรุป`, expectancy([10, 20], 0).enough, false);
  t("expectancy: ขอบล่างติดลบ -> ไม่ขึ้นเขียว", expectancy([10, -5, 3], 0).positive, false);
  t("expectancy: ชนะทุกไม้ใกล้เคียงกัน -> ขึ้นเขียว",
    expectancy([5, 5.2, 4.8, 5.1, 4.9], 0).positive, true);

  // ---- MFE / MAE ----
  t("MAE: pred=up คือฝั่งที่ราคาลง", adverseExcursions([rec({ up15: 7, dn15: 3 })], 15), [3]);
  t("MAE: pred=down คือฝั่งที่ราคาขึ้น",
    adverseExcursions([rec({ pred: "down", up15: 7, dn15: 3 })], 15), [7]);
  t("MFE: pred=up คือฝั่งที่ราคาขึ้น", favorableExcursions([rec({ up15: 7, dn15: 3 })], 15), [7]);
  t("percentile: กลางชุด", percentile([1, 2, 3, 4, 5], 0.5), 3);
  t("stopOut: MAE เท่าระยะ SL พอดีนับว่าโดนชน",
    stopOutRates([rec({ dn15: 5 })], 15, [5])[0].hitPct, 100);
  t("stopOut: MAE ต่ำกว่าระยะ SL ไม่นับ",
    stopOutRates([rec({ dn15: 4.99 })], 15, [5])[0].hitPct, 0);

  // ---- อ่านสกุลเงินจากหัวรายงาน ----
  t("สกุลเงิน: MT5 Exness (cent)",
    detectCurrency("Account: 183875989&nbsp;(USC,&nbsp;Exness-MT5Real25,&nbsp;real,&nbsp;Hedge)"), "USC");
  t("สกุลเงิน: MT5 มาตรฐาน",
    detectCurrency("<td>Account:</td><td>7654321 (USD, MetaQuotes-Demo, demo, Netting)</td>"), "USD");
  t("สกุลเงิน: MT4 แบบมี label", detectCurrency("Account: 12345 main Currency: USD"), "USD");
  t("สกุลเงิน: ภาษาไทย", detectCurrency("สกุลเงิน: USD"), "USD");
  t("สกุลเงิน: หาไม่เจอ -> ว่าง", detectCurrency("<table><tr><td>Time</td></tr></table>"), "");

  // ---- แปลงเป็นบาท ----
  t("บาท: USD คูณเรตตรง ๆ", toThb(10, "USD", 33.34), 333.4);
  t("บาท: USC หารร้อยก่อน", toThb(1000, "USC", 33.34), 333.4);
  t("บาท: ตัวพิมพ์เล็กก็ได้", toThb(1000, "usc", 33.34), 333.4);
  t("บาท: ขาดทุนติดลบ", toThb(-591.7, "USC", 33.34), -197.27);
  t("บาท: สกุลที่ยังไม่รองรับ -> null", toThb(100, "EUR", 33.34), null);
  t("รองรับ USC", supportsThb("USC"), true);
  t("ไม่รองรับ EUR", supportsThb("EUR"), false);
  t("รองรับ: สกุลว่าง -> false", supportsThb(""), false);
  t("จัดรูปแบบบาท", fmtThb(1234.5), "฿1,234.50");
  t("จัดรูปแบบบาท: ใส่เครื่องหมายบวก", fmtThb(197.28, true), "+฿197.28");
  t("จัดรูปแบบบาท: ติดลบใช้ขีดหน้าสัญลักษณ์", fmtThb(-40.21, true), "-฿40.21");

  // ---- พฤติกรรม: เข้าใหม่หลังแพ้ vs หลังชนะ ----
  const seq = [
    trade({ openMin: 0, closeMin: 10, profit: -100 }),   // แพ้
    trade({ openMin: 15, closeMin: 20, profit: 50 }),    // เข้าใหม่หลังแพ้ 5 นาที
    trade({ openMin: 80, closeMin: 90, profit: 60 }),    // เข้าใหม่หลังชนะ 60 นาที
  ];
  const re = reentryGaps(seq);
  t("เข้าใหม่: ช่องว่างหลังแพ้", re.afterLoss, [5]);
  t("เข้าใหม่: ช่องว่างหลังชนะ", re.afterWin, [60]);
  t("เข้าใหม่: เร็วกว่ากี่เท่า", re.ratio, 12);
  t("เข้าใหม่: ไม้แรกไม่มีไม้ก่อนหน้า จึงไม่ถูกนับ", re.afterLoss.length + re.afterWin.length, 2);
  t("เข้าใหม่: เปิดคู่พร้อมกันนับช่องว่างครั้งเดียว",
    reentryGaps([
      trade({ openMin: 0, closeMin: 10, profit: -100 }),
      trade({ openMin: 15, closeMin: 20, profit: 5, lots: 0.4 }),
      trade({ openMin: 15, closeMin: 20, profit: 6, lots: 0.3 }),
    ]).afterLoss, [5]);
  t("เข้าใหม่: ไม้ที่เปิดขณะไม้เดิมยังค้าง ไม่นับเป็นการเข้าใหม่",
    reentryGaps([
      trade({ openMin: 0, closeMin: 100, profit: -10 }),
      trade({ openMin: 50, closeMin: 60, profit: 5 }),
    ]).afterLoss.length, 0);

  // ---- ระยะเวลาถือ ----
  const hs = holdSplit([
    trade({ openMin: 0, closeMin: 10, profit: 50 }),
    trade({ openMin: 20, closeMin: 50, profit: -50 }),
  ]);
  t("ถือ: มัธยฐานไม้กำไร", hs.winMedian, 10);
  t("ถือ: มัธยฐานไม้ขาดทุน", hs.lossMedian, 30);
  t("ถือ: ตัดกำไรเร็วกว่าทนขาดทุน", hs.cutsWinnersEarly, true);
  t("ถือ: ไม่มีไม้ขาดทุน -> ไม่ตัดสิน",
    holdSplit([trade({ openMin: 0, closeMin: 5, profit: 1 })]).cutsWinnersEarly, false);

  // ---- ซ้อนไม้ ----
  const ovPair = overlaps([
    trade({ openMin: 0, closeMin: 30, profit: 10, side: "buy", lots: 0.4 }),
    trade({ openMin: 0, closeMin: 30, profit: 10, side: "buy", lots: 0.4 }),
  ]);
  t("ซ้อนไม้: เปิดพร้อมกันรวมล็อต", ovPair.peakLots, 0.8);
  t("ซ้อนไม้: นับเฉพาะไม้ที่มาทับ", ovPair.stacked, 1);
  t("ซ้อนไม้: จังหวะละรายการเดียว", ovPair.moments.length, 1);
  t("ซ้อนไม้: คนละทางไม่รวมกัน",
    overlaps([
      trade({ openMin: 0, closeMin: 30, profit: 1, side: "buy", lots: 0.4 }),
      trade({ openMin: 0, closeMin: 30, profit: 1, side: "sell", lots: 0.4 }),
    ]).peakLots, 0.4);
  t("ซ้อนไม้: เข้าทีละไม้ไม่นับว่าซ้อน",
    overlaps([
      trade({ openMin: 0, closeMin: 10, profit: 1 }),
      trade({ openMin: 20, closeMin: 30, profit: 1 }),
    ]).stacked, 0);

  // ---- กำไรกระจุก ----
  const con = concentration([
    trade({ openMin: 0, closeMin: 1, profit: 300 }),
    trade({ openMin: 2, closeMin: 3, profit: 50 }),
    trade({ openMin: 4, closeMin: 5, profit: -100 }),
    trade({ openMin: 6, closeMin: 7, profit: -100 }),
  ]);
  t("กระจุก: กำไรสุทธิ", con.net, 150);
  t("กระจุก: ตัดไม้ที่ดีสุด 1 ไม้", con.without[0].net, -150);
  t("กระจุก: พลิกเป็นลบที่ไม้ที่ 1", con.flipsAt, 1);
  t("กระจุก: กระจายดีไม่พลิก",
    concentration([
      trade({ openMin: 0, closeMin: 1, profit: 100 }),
      trade({ openMin: 2, closeMin: 3, profit: 100 }),
      trade({ openMin: 4, closeMin: 5, profit: 100 }),
      trade({ openMin: 6, closeMin: 7, profit: 100 }),
    ]).flipsAt, null);

  // ---- รวม ----
  t("พฤติกรรม: ไม่มีไม้ -> null", analyseBehaviour([]), null);
  const beh = analyseBehaviour([
    trade({ openMin: 0, closeMin: 30, profit: 10, lots: 0.4, sl: 4290 }),
    trade({ openMin: 0, closeMin: 30, profit: -20, lots: 0.4 }),
  ]);
  t("พฤติกรรม: นับไม้ที่ตั้ง SL", beh?.withSl, 1);
  // ถือรวม 0.8 ล็อต · ราคาสวน $20 -> 20 x 0.8 x 100 = 1600
  t("พฤติกรรม: ขาดทุนถ้าราคาสวน $20", beh?.shockLoss, 1600);
  t("พฤติกรรม: ไม้แย่สุด", beh?.worstLoss, -20);

  // ---- อ่านข้อมูลบัญชีจากหัวรายงาน ----
  const acc = parseAccount(
    "<td>Account:</td><td>7654321 (USC, Exness-MT5Real25, real, Hedge)</td>" +
    "<td>Company:</td><td>Exness Technologies Ltd</td><td>Balance:</td><td>2 890.60</td>",
  );
  t("บัญชี: เลขบัญชี", acc?.id, "7654321");
  t("บัญชี: สกุลเงิน", acc?.currency, "USC");
  t("บัญชี: เซิร์ฟเวอร์", acc?.server, "Exness-MT5Real25");
  t("บัญชี: ประเภท", `${acc?.kind} ${acc?.mode}`, "real Hedge");
  t("บัญชี: ยอดเงิน (มีช่องว่างคั่นหลักพัน)", acc?.balance, 2890.6);
  t("บัญชี: ไม่มีหัวรายงาน -> null", parseAccount("Ticket,Type"), null);
  // "Balance" ลอย ๆ ที่ไม่มีโคลอนต้องไม่ถูกจับมาเป็นป้าย
  t("บัญชี: ข้ามคำว่า Balance ที่ไม่ใช่ป้าย",
    parseAccount("<td>Balance</td><td>xx</td><td>Account:</td><td>1 (USD, S, real, Net)</td>" +
                 "<td>Balance:</td><td>500.00</td>")?.balance, 500);

  // ---- ช่วงความเชื่อมั่นของอัตราชนะ (Wilson) ----
  t("wilson: 15/22 คร่อม 50%", wilson(15, 22).map((x) => x > 50), [false, true]);
  t("wilson: ชนะหมดก็ไม่เกิน 100%", wilson(5, 5)[1] <= 100, true);
  t("wilson: แพ้หมดก็ไม่ต่ำกว่า 0%", wilson(0, 5)[0] >= 0, true);
  t("wilson: n มากขึ้นช่วงต้องแคบลง",
    wilson(60, 100)[1] - wilson(60, 100)[0] < wilson(6, 10)[1] - wilson(6, 10)[0], true);
  t("wilson: ไม่มีข้อมูล", wilson(0, 0), [0, 0]);

  // ---- เส้นกำไรสะสม / การถอย ----
  // ทุน 1000 -> +500 (peak 1500) -> -300 -> -200 (ต่ำสุด 1000) -> +100
  const curve = equityCurve([
    trade({ openMin: 0, closeMin: 1, profit: 500 }),
    trade({ openMin: 2, closeMin: 3, profit: -300 }),
    trade({ openMin: 4, closeMin: 5, profit: -200 }),
    trade({ openMin: 6, closeMin: 7, profit: 100 }),
  ], 1000);
  t("เส้นทุน: ถอยจากยอดสูงสุด", curve.maxDrawdown, 500);
  t("เส้นทุน: คิดเป็น % ของยอดสูงสุด", curve.maxDrawdownPct, 33.3);
  t("เส้นทุน: แพ้ติดกันมากสุด", curve.longestLossStreak, 2);
  t("เส้นทุน: ชนะติดกันมากสุด", curve.longestWinStreak, 1);
  t("เส้นทุน: เรียงตามเวลาปิด ไม่ใช่เวลาเปิด",
    equityCurve([
      trade({ openMin: 0, closeMin: 100, profit: 10 }),
      trade({ openMin: 5, closeMin: 10, profit: -5 }),
    ], 0).curve.map((c) => c.cum), [-5, 5]);

  // ---- ขนาดล็อต ----
  const lp = lotProfile([
    trade({ openMin: 0, closeMin: 1, profit: 1, lots: 0.4 }),
    trade({ openMin: 2, closeMin: 3, profit: 1, lots: 0.4 }),
    trade({ openMin: 4, closeMin: 5, profit: 1, lots: 1 }),
  ]);
  t("ล็อต: ล่าสุด", lp?.latest, 1);
  t("ล็อต: ค่ากลาง", lp?.median, 0.4);
  t("ล็อต: โตกว่าค่ากลางกี่เท่า", lp?.growth, 2.5);
  t("ล็อต: ไม่มีไม้ -> null", lotProfile([]), null);

  const pass = out.filter((r) => r[1]).length;
  return new Response(
    out.map(([n, ok, d]) => `${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "   " + d}`).join("\n") +
      `\n\n${pass}/${out.length} ผ่าน\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
