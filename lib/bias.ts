/**
 * กฎ "ทิศทางทอง" — ความสัมพันธ์มหภาคแบบพื้นฐานระหว่างข่าวเศรษฐกิจกับราคาทอง
 *
 * หลักคิด (ทองไม่มีดอกเบี้ย จึงอ่อนไหวกับดอกเบี้ยแท้จริงและค่าเงินดอลลาร์):
 *   เศรษฐกิจสหรัฐฯ แข็ง / เงินเฟ้อสูง -> เฟดคงดอกเบี้ยสูงนาน -> ดอลลาร์+ยิลด์ขึ้น -> ทองมักลง
 *   เศรษฐกิจสหรัฐฯ อ่อน / เงินเฟ้อต่ำ -> ตลาดคาดเฟดลดดอกเบี้ย -> ดอลลาร์อ่อน   -> ทองมักขึ้น
 *
 * *** วัดกับราคาจริงแล้วพบว่ากฎนี้แม่น ~71% เฉพาะ 10-15 นาทีแรกหลังข่าวใหญ่สหรัฐฯ
 *     หลัง 30 นาทีเหลือ ~50% เท่ากับเดาสุ่ม — ดูสถิติจริงได้ที่หน้า Reaction Lab ***
 */

import type { Bias, CalendarEvent, Direction } from "./types";

const HAWKISH: Direction = "down"; // ตัวเลขดี/ร้อนแรง -> ลบต่อทอง
const DOVISH: Direction = "up"; // ตัวเลขแย่/อ่อนแอ -> บวกต่อทอง

const WHY_HOT = "ตัวเลขแข็งแกร่งเกินคาด → เฟดไม่รีบลดดอกเบี้ย → ดอลลาร์และบอนด์ยิลด์ขึ้น → กดดันทอง";
const WHY_INFL = "เงินเฟ้อสูงเกินคาด → ตลาดคาดเฟดคงดอกเบี้ยสูงนานขึ้น → ดอลลาร์แข็ง → ทองมักย่อลงทันที";
const WHY_WEAKGOOD = "ตัวเลขยิ่งสูง = เศรษฐกิจยิ่งแย่ → ตลาดคาดเฟดลดดอกเบี้ยเร็วขึ้น → ดอลลาร์อ่อน → หนุนทอง";
const WHY_TONE_FED =
  "ไม่ต้องดูตัวเลข ให้ฟังโทนคำพูด: สาย “ผ่อนคลาย/จ่อลดดอกเบี้ย” (Dovish) → ทองขึ้น, สาย “คุมเงินเฟ้อ/ยังไม่ลด” (Hawkish) → ทองลง";
const WHY_EU = "ยุโรปแข็งแรง → ยูโรแข็ง → ดัชนีดอลลาร์ (DXY) อ่อนลง → หนุนทองทางอ้อมเล็กน้อย";
const WHY_CN =
  "จีนคือผู้บริโภคทองรายใหญ่สุดของโลก เศรษฐกิจจีนดี → ดีมานด์ทองจริงและการซื้อของธนาคารกลางเพิ่ม → บวกต่อทองอ่อน ๆ";

interface Rule {
  country: string | null;
  match: RegExp;
  th: string;
  kind: "number" | "tone" | "";
  dirIfHigher: Direction;
  strength: "strong" | "mild";
  why: string;
  volatile: boolean;
  key: boolean;
}

const r = (
  country: string | null,
  match: RegExp,
  th: string,
  kind: "number" | "tone" | "",
  dirIfHigher: Direction,
  strength: "strong" | "mild",
  why: string,
  volatile = false,
  key = false,
): Rule => ({ country, match, th, kind, dirIfHigher, strength, why, volatile, key });

/** เรียงจาก "เฉพาะเจาะจงที่สุด" ไป "กว้างที่สุด" — เจอตัวแรกที่ match ถือว่าชนะ */
const RULES: Rule[] = [
  // --------- นโยบายการเงินเฟด (ดูโทน ไม่ใช่ตัวเลข) ---------
  r("US", /Fed Interest Rate Decision|FOMC Statement|Fed Rate Decision|Federal Funds Rate/i, "มติดอกเบี้ยเฟด (FOMC)", "tone", "", "strong", WHY_TONE_FED, true, true),
  r("US", /FOMC Economic Projections|Dot Plot/i, "คาดการณ์เศรษฐกิจ/Dot Plot ของเฟด", "tone", "", "strong", WHY_TONE_FED, true, true),
  r("US", /Fed Press Conference|FOMC Press Conference/i, "แถลงข่าวประธานเฟด", "tone", "", "strong", WHY_TONE_FED, true, true),
  r("US", /FOMC Minutes|Fed Minutes/i, "รายงานการประชุมเฟด (Minutes)", "tone", "", "strong", WHY_TONE_FED, true, true),
  r("US", /Powell|Fed Chair/i, "ประธานเฟด (พาวเวลล์) แถลง", "tone", "", "strong", WHY_TONE_FED, true, true),
  r("US", /Fed .*(Speech|Testimony|Speaks)|FOMC Member/i, "กรรมการเฟดแถลง", "tone", "", "mild", WHY_TONE_FED),

  // --------- เงินเฟ้อสหรัฐฯ ---------
  r("US", /Core PCE/i, "ดัชนีราคา PCE พื้นฐาน (มาตรวัดเงินเฟ้อที่เฟดใช้จริง)", "number", HAWKISH, "strong", WHY_INFL, true, true),
  r("US", /PCE Price/i, "ดัชนีราคา PCE", "number", HAWKISH, "strong", WHY_INFL, false, true),
  r("US", /Core Inflation Rate|Core CPI|Core Consumer Price/i, "เงินเฟ้อพื้นฐาน (Core CPI)", "number", HAWKISH, "strong", WHY_INFL, true, true),
  r("US", /Inflation Rate|CPI|Consumer Price Index/i, "อัตราเงินเฟ้อ (CPI)", "number", HAWKISH, "strong", WHY_INFL, true, true),
  r("US", /Core PPI|Core Producer Price/i, "ดัชนีราคาผู้ผลิตพื้นฐาน (Core PPI)", "number", HAWKISH, "strong", WHY_INFL, false, true),
  r("US", /PPI|Producer Price/i, "ดัชนีราคาผู้ผลิต (PPI) — เงินเฟ้อต้นทาง", "number", HAWKISH, "strong", WHY_INFL, false, true),
  r("US", /Inflation Expectations/i, "คาดการณ์เงินเฟ้อ", "number", HAWKISH, "mild", WHY_INFL),
  r("US", /Import Prices|Export Prices/i, "ราคาสินค้านำเข้า/ส่งออก", "number", HAWKISH, "mild", WHY_INFL),

  // --------- ตลาดแรงงานสหรัฐฯ (ตัวเลขกลับด้าน — ยิ่งสูงยิ่งแย่) ---------
  r("US", /Jobless Claims|Unemployment Claims/i, "ยอดผู้ขอรับสวัสดิการว่างงาน", "number", DOVISH, "strong", WHY_WEAKGOOD, false, true),
  r("US", /Unemployment Rate/i, "อัตราการว่างงาน", "number", DOVISH, "strong", WHY_WEAKGOOD, true, true),
  r("US", /Challenger Job Cuts/i, "ยอดประกาศปลดพนักงาน (Challenger)", "number", DOVISH, "mild", WHY_WEAKGOOD),

  // --------- ตลาดแรงงานสหรัฐฯ (ยิ่งสูงยิ่งดี -> กดทอง) ---------
  r("US", /ADP/i, "การจ้างงานภาคเอกชน ADP", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /Non.?Farm Payroll|Non.?Farm Employment Change/i, "การจ้างงานนอกภาคเกษตร (NFP)", "number", HAWKISH, "strong", WHY_HOT, true, true),
  r("US", /Average Hourly Earnings/i, "ค่าจ้างเฉลี่ยต่อชั่วโมง", "number", HAWKISH, "strong", "ค่าจ้างขึ้นแรง = เงินเฟ้อฝั่งบริการยังร้อน → เฟดเข้มงวดต่อ → กดดันทอง", false, true),
  r("US", /JOLTs|Job Openings/i, "ตำแหน่งงานว่าง (JOLTS)", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /Employment Change|Payrolls/i, "การเปลี่ยนแปลงการจ้างงาน", "number", HAWKISH, "mild", WHY_HOT),

  // --------- กิจกรรมเศรษฐกิจสหรัฐฯ ---------
  r("US", /ISM Manufacturing/i, "ดัชนี ISM ภาคการผลิต", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /ISM Services|ISM Non.?Manufacturing/i, "ดัชนี ISM ภาคบริการ", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /GDP/i, "อัตราการเติบโตเศรษฐกิจ (GDP)", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /Retail Sales/i, "ยอดค้าปลีก", "number", HAWKISH, "strong", WHY_HOT, false, true),
  r("US", /Durable Goods/i, "ยอดสั่งซื้อสินค้าคงทน", "number", HAWKISH, "mild", WHY_HOT, false, true),
  r("US", /Michigan Consumer Sentiment|UoM Consumer Sentiment|Consumer Sentiment/i, "ความเชื่อมั่นผู้บริโภค (ม.มิชิแกน)", "number", HAWKISH, "mild", WHY_HOT, false, true),
  r("US", /Consumer Confidence/i, "ดัชนีความเชื่อมั่นผู้บริโภค", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Manufacturing PMI/i, "ดัชนี PMI ภาคการผลิต", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Services PMI|Composite PMI/i, "ดัชนี PMI ภาคบริการ/รวม", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Industrial Production|Factory Orders|Capacity Utilization/i, "การผลิตภาคอุตสาหกรรม", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Personal Spending|Personal Income/i, "รายได้/การใช้จ่ายส่วนบุคคล", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Housing Starts|Building Permits|New Home Sales|Existing Home Sales|Pending Home Sales/i, "ข้อมูลภาคอสังหาฯ", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Empire State|Philadelphia Fed|Philly Fed|Chicago PMI|Richmond|Dallas Fed|Kansas Fed|NY Fed/i, "ดัชนีภาคการผลิตระดับภูมิภาค", "number", HAWKISH, "mild", WHY_HOT),
  r("US", /Balance of Trade|Trade Balance/i, "ดุลการค้า", "number", HAWKISH, "mild", "ขาดดุลน้อยลง/เกินดุลมากขึ้น → ดอลลาร์แข็ง → กดดันทองเล็กน้อย"),

  // --------- ยุโรป (ผลทางอ้อมผ่านค่าเงิน) ---------
  r("EU", /Interest Rate Decision|ECB Press|ECB Rate|Main Refinancing Rate|Monetary Policy Statement/i, "มติดอกเบี้ย ECB", "tone", "", "mild", "ECB เข้มงวด → ยูโรแข็ง → ดัชนีดอลลาร์อ่อน → หนุนทองทางอ้อม (ถ้า ECB ผ่อนคลาย ผลกลับกัน)", false, true),
  r("EU", /Inflation Rate|CPI|Consumer Price/i, "เงินเฟ้อยูโรโซน", "number", DOVISH, "mild", WHY_EU, false, true),
  r("EU", /GDP|PMI|Retail Sales|ZEW|Ifo|Sentix|Industrial Production|Unemployment Rate/i, "ข้อมูลเศรษฐกิจยูโรโซน", "number", DOVISH, "mild", WHY_EU),
  r("EU", /Speech|Lagarde/i, "กรรมการ ECB แถลง", "tone", "", "mild", "ฟังโทน: ECB เข้มงวด → ยูโรแข็ง → ดอลลาร์อ่อน → บวกต่อทองเล็กน้อย"),

  // --------- จีน (ผลผ่านดีมานด์ทองคำจริง) ---------
  r("CN", /Loan Prime Rate|PBoC|Interest Rate/i, "ดอกเบี้ยนโยบายจีน (LPR/PBoC)", "tone", "", "mild", "จีนลดดอกเบี้ย/อัดฉีดกระตุ้นเศรษฐกิจ → ดีมานด์ทองในประเทศเพิ่ม → บวกต่อทอง", false, true),
  r("CN", /GDP|Retail Sales|Industrial Production|Exports|Imports|Balance of Trade|PMI/i, "ข้อมูลเศรษฐกิจจีน", "number", DOVISH, "mild", WHY_CN),
  r("CN", /Inflation Rate|CPI|PPI/i, "เงินเฟ้อจีน", "number", DOVISH, "mild", WHY_CN),

  // --------- ทั่วไป ---------
  r(null, /Holiday/i, "วันหยุดตลาด", "", "", "mild", "ตลาดหยุด สภาพคล่องบาง — สเปรดกว้างและราคาเหวี่ยงง่ายผิดปกติ ควรเลี่ยงเทรด"),
];

const UNRANKED = 999;

const EMPTY: Bias = {
  th: "", kind: "", dirIfHigher: "", strength: "", why: "",
  volatile: false, key: false, surprise: "", outcome: "", rank: UNRANKED,
};

function matchRule(event: Pick<CalendarEvent, "title" | "indicator" | "country">) {
  const text = `${event.title || ""} ${event.indicator || ""}`;
  for (let i = 0; i < RULES.length; i++) {
    const rule = RULES[i];
    if (rule.country !== null && rule.country !== event.country) continue;
    if (rule.match.test(text)) return { rule, rank: i };
  }
  return null;
}

/** เทียบผลจริงกับคาดการณ์ */
function surpriseOf(event: Pick<CalendarEvent, "actualRaw" | "forecastRaw">) {
  const { actualRaw: actual, forecastRaw: forecast } = event;
  if (typeof actual !== "number" || typeof forecast !== "number") return "" as const;
  if (!Number.isFinite(actual) || !Number.isFinite(forecast)) return "" as const;
  const tolerance = Math.abs(forecast) * 0.0005;
  if (Math.abs(actual - forecast) <= tolerance) return "inline" as const;
  return actual > forecast ? ("higher" as const) : ("lower" as const);
}

/** เติมข้อมูล "ทิศทางทอง" ให้กับข่าวหนึ่งรายการ */
export function annotate(event: CalendarEvent): Bias {
  const matched = matchRule(event);
  if (!matched) return { ...EMPTY };

  const { rule, rank } = matched;
  const surprise = surpriseOf(event);

  let outcome: Bias["outcome"] = "";
  if (rule.kind === "number" && surprise) {
    if (surprise === "inline") outcome = "neutral";
    else if (surprise === "higher") outcome = rule.dirIfHigher;
    else outcome = rule.dirIfHigher === "down" ? "up" : "down";
  }

  return {
    th: rule.th,
    kind: rule.kind,
    dirIfHigher: rule.dirIfHigher,
    strength: rule.strength,
    why: rule.why,
    volatile: rule.volatile,
    key: rule.key,
    surprise,
    outcome,
    rank,
  };
}

/** ข่าวสำคัญที่ต้องแสดงเสมอ แม้ต้นทางจะจัดความแรงไว้ต่ำกว่าเกณฑ์ */
export function isKeyEvent(event: CalendarEvent): boolean {
  return annotate(event).key;
}
