/**
 * แปลชื่อข่าวเป็นภาษาไทย + กรองข่าวที่ไม่เกี่ยวกับทอง
 *
 * แยกจาก bias.ts เพราะคนละหน้าที่:
 *   translate.ts = "ข่าวนี้ชื่อไทยว่าอะไร"
 *   bias.ts      = "ข่าวนี้ส่งผลต่อทองยังไง"
 *
 * รองรับชื่อจากทั้ง TradingView ("Core Inflation Rate MoM")
 * และ ForexFactory ("Core CPI m/m") ซึ่งตั้งชื่อคนละแบบ
 */

import type { CalendarEvent } from "./types";

/** ข่าวที่ไม่เกี่ยวกับทิศทางทองเลย — ซ่อนไว้เว้นแต่สั่งให้แสดงทั้งหมด */
const NOISE =
  /API Crude Oil|EIA .*Stock|MBA \d+-Year|MBA Mortgage|Redbook|Jobless Claims 4-week|ADP Employment Change Weekly|New Car Registrations|TIC Flows|Bill Auction|Bond Auction|Note Auction|Business Inventories|Wholesale Inventories|Retail Inventories|Monthly Budget Statement|Current Account|FDI \(YTD\)|General Council Meeting|Baker Hughes/i;

/** คำต่อท้ายที่บอก "รูปแบบการวัด" — ต้องแสดง ไม่งั้นข่าวชื่อซ้ำกันหมด */
const SUFFIXES: [RegExp, string][] = [
  [/\bMoM\b|\bm\/m\b/i, "เทียบเดือนก่อน"],
  [/\bYoY\b|\by\/y\b/i, "เทียบปีก่อน"],
  [/\bQoQ\b|\bq\/q\b/i, "เทียบไตรมาสก่อน"],
  [/\bFlash\b|\bPrel\b|\bAdv\b|\bPreliminary\b/i, "ตัวเลขเบื้องต้น"],
  [/\bFinal\b|\bRevised\b/i, "ตัวเลขสุดท้าย"],
  [/\bs\.a\b/i, "ปรับฤดูกาล"],
  [/Ex Transp/i, "ไม่รวมขนส่ง"],
  [/ex Defense/i, "ไม่รวมกลาโหม"],
  [/Ex Gas\/Autos/i, "ไม่รวมน้ำมันและรถยนต์"],
  [/Ex Autos/i, "ไม่รวมรถยนต์"],
  [/Ex Food, Energy and Trade/i, "ไม่รวมอาหาร พลังงาน การค้า"],
  [/Control Group/i, "กลุ่มควบคุม"],
];

/** [ประเทศ (null = ทุกประเทศ), regex, ชื่อไทย] — เรียงจากเฉพาะเจาะจงไปกว้าง ตัวแรกที่ตรงชนะ */
const TITLES: [string | null, RegExp, string][] = [
  // ---------- สหรัฐฯ: เฟด ----------
  ["US", /^Fed Interest Rate Decision|^Federal Funds Rate|^FOMC Statement/i, "มติดอกเบี้ยเฟด (FOMC)"],
  ["US", /^FOMC Economic Projections/i, "ประมาณการเศรษฐกิจเฟด (Dot Plot)"],
  ["US", /^FOMC Minutes/i, "รายงานการประชุมเฟด (Minutes)"],
  ["US", /^Fed Press Conference|^FOMC Press Conference/i, "แถลงข่าวประธานเฟด"],
  ["US", /^Fed Chair Powell|^Powell/i, "ประธานเฟด พาวเวลล์ แถลง"],
  ["US", /^FOMC Member/i, "กรรมการเฟดแถลง"],

  // ---------- สหรัฐฯ: เงินเฟ้อ ----------
  ["US", /^Core PCE Price/i, "ดัชนีราคา PCE พื้นฐาน (เฟดดูตัวนี้ที่สุด)"],
  ["US", /^Core PCE Prices/i, "ดัชนีราคา PCE พื้นฐาน"],
  ["US", /^PCE Price|^PCE Prices/i, "ดัชนีราคา PCE"],
  ["US", /^Core Inflation Rate|^Core CPI/i, "อัตราเงินเฟ้อพื้นฐาน (Core CPI)"],
  ["US", /^Inflation Rate|^CPI [my]\/[my]/i, "อัตราเงินเฟ้อ (CPI)"],
  ["US", /^CPI\b/i, "ดัชนีราคาผู้บริโภค (ระดับดัชนี)"],
  ["US", /^Core PPI/i, "ดัชนีราคาผู้ผลิตพื้นฐาน (Core PPI)"],
  ["US", /^PPI\b/i, "ดัชนีราคาผู้ผลิต (PPI)"],
  ["US", /^Import Prices/i, "ราคาสินค้านำเข้า"],
  ["US", /^Export Prices/i, "ราคาสินค้าส่งออก"],

  // ---------- สหรัฐฯ: แรงงาน ----------
  ["US", /^Non ?Farm Payrolls$|^Non.?Farm Employment Change/i, "การจ้างงานนอกภาคเกษตร (NFP)"],
  ["US", /^Nonfarm Payrolls Private/i, "การจ้างงานนอกภาคเกษตร ภาคเอกชน"],
  ["US", /^U-6 Unemployment Rate/i, "อัตราการว่างงานแบบกว้าง (U-6)"],
  ["US", /^Unemployment Rate/i, "อัตราการว่างงาน"],
  ["US", /^Participation Rate/i, "อัตราการเข้าร่วมกำลังแรงงาน"],
  ["US", /^Average Hourly Earnings/i, "ค่าจ้างเฉลี่ยต่อชั่วโมง"],
  ["US", /^Initial Jobless Claims|^Unemployment Claims/i, "ยอดขอรับสวัสดิการว่างงานครั้งแรก"],
  ["US", /^Continuing Jobless Claims/i, "ยอดขอรับสวัสดิการว่างงานต่อเนื่อง"],
  ["US", /^JOLTs Job Openings/i, "ตำแหน่งงานว่าง (JOLTS)"],
  ["US", /^JOLTs Job Quits/i, "อัตราการลาออกจากงาน (JOLTS)"],
  ["US", /^ADP/i, "การจ้างงานภาคเอกชน (ADP)"],
  ["US", /^Challenger Job Cuts/i, "ยอดประกาศปลดพนักงาน (Challenger)"],

  // ---------- สหรัฐฯ: เศรษฐกิจ ----------
  ["US", /^GDP Growth Rate|^(Advance|Prelim|Final) GDP/i, "อัตราการเติบโตเศรษฐกิจ (GDP)"],
  ["US", /^GDP Price Index/i, "ดัชนีราคา GDP"],
  ["US", /^GDP Sales/i, "ยอดขายสุดท้ายตาม GDP"],
  ["US", /^Core Retail Sales/i, "ยอดค้าปลีก ไม่รวมรถยนต์"],
  ["US", /^Retail Sales/i, "ยอดค้าปลีก"],
  ["US", /^ISM Manufacturing PMI/i, "ดัชนี ISM ภาคการผลิต"],
  ["US", /^ISM Manufacturing Employment/i, "ISM ภาคการผลิต: การจ้างงาน"],
  ["US", /^ISM Manufacturing New Orders/i, "ISM ภาคการผลิต: คำสั่งซื้อใหม่"],
  ["US", /^ISM Manufacturing Prices/i, "ISM ภาคการผลิต: ราคาที่จ่าย"],
  ["US", /^ISM Services PMI/i, "ดัชนี ISM ภาคบริการ"],
  ["US", /^ISM Services Business Activity/i, "ISM ภาคบริการ: กิจกรรมธุรกิจ"],
  ["US", /^ISM Services Employment/i, "ISM ภาคบริการ: การจ้างงาน"],
  ["US", /^ISM Services New Orders/i, "ISM ภาคบริการ: คำสั่งซื้อใหม่"],
  ["US", /^ISM Services Prices/i, "ISM ภาคบริการ: ราคาที่จ่าย"],
  ["US", /^Durable Goods Orders/i, "ยอดสั่งซื้อสินค้าคงทน"],
  ["US", /^Factory Orders/i, "คำสั่งซื้อภาคโรงงาน"],
  ["US", /^Industrial Production/i, "การผลิตภาคอุตสาหกรรม"],
  ["US", /^Capacity Utilization/i, "อัตราการใช้กำลังการผลิต"],
  ["US", /^Michigan Consumer Sentiment|UoM Consumer Sentiment/i, "ความเชื่อมั่นผู้บริโภค (ม.มิชิแกน)"],
  ["US", /^Michigan Inflation Expectations/i, "คาดการณ์เงินเฟ้อ (ม.มิชิแกน)"],
  ["US", /^CB Consumer Confidence|^Consumer Confidence/i, "ความเชื่อมั่นผู้บริโภค (Conference Board)"],
  ["US", /^Personal Income/i, "รายได้ส่วนบุคคล"],
  ["US", /^Personal Spending/i, "การใช้จ่ายส่วนบุคคล"],
  ["US", /^Building Permits/i, "ใบอนุญาตก่อสร้าง"],
  ["US", /^Housing Starts/i, "การเริ่มสร้างบ้านใหม่"],
  ["US", /^New Home Sales/i, "ยอดขายบ้านใหม่"],
  ["US", /^Existing Home Sales/i, "ยอดขายบ้านมือสอง"],
  ["US", /^Pending Home Sales/i, "ยอดทำสัญญาซื้อบ้าน"],
  ["US", /^NAHB Housing Market Index/i, "ดัชนีตลาดที่อยู่อาศัย (NAHB)"],
  ["US", /^S&P\/Case-Shiller/i, "ดัชนีราคาบ้าน Case-Shiller"],
  ["US", /^NY Empire State|^Empire State/i, "ดัชนีภาคการผลิตรัฐนิวยอร์ก"],
  ["US", /^Philadelphia Fed|^Philly Fed/i, "ดัชนีภาคการผลิตเฟดฟิลาเดลเฟีย"],
  ["US", /^Dallas Fed/i, "ดัชนีภาคการผลิตเฟดดัลลัส"],
  ["US", /^Richmond Fed/i, "ดัชนีภาคการผลิตเฟดริชมอนด์"],
  ["US", /^Kansas Fed/i, "ดัชนีภาคการผลิตเฟดแคนซัส"],
  ["US", /^Chicago PMI/i, "ดัชนี PMI ชิคาโก"],
  ["US", /^Chicago Fed National Activity/i, "ดัชนีกิจกรรมเศรษฐกิจ (เฟดชิคาโก)"],
  ["US", /^Goods Trade Balance/i, "ดุลการค้าสินค้า"],
  ["US", /^Balance of Trade/i, "ดุลการค้า"],
  ["US", /^Exports$/i, "มูลค่าส่งออก"],
  ["US", /^Imports$/i, "มูลค่านำเข้า"],

  // ---------- ยุโรป ----------
  ["EU", /^ECB President Lagarde Speech/i, "ประธาน ECB (ลาการ์ด) แถลง"],
  ["EU", /^ECB Monetary Policy Meeting Accounts/i, "รายงานการประชุมนโยบายการเงิน ECB"],
  ["EU", /^ECB Interest Rate Decision|^Interest Rate Decision|^Main Refinancing Rate|^Monetary Policy Statement/i, "มติดอกเบี้ย ECB"],
  ["EU", /^ECB Press Conference/i, "แถลงข่าว ECB"],
  ["EU", /^Core Inflation Rate/i, "เงินเฟ้อพื้นฐานยูโรโซน"],
  ["EU", /^Inflation Rate/i, "อัตราเงินเฟ้อยูโรโซน"],
  ["EU", /^CPI\b/i, "ดัชนีราคาผู้บริโภคยูโรโซน"],
  ["EU", /^ZEW Economic Sentiment/i, "ดัชนีความเชื่อมั่นเศรษฐกิจ (ZEW)"],
  ["EU", /^Economic Sentiment/i, "ดัชนีความเชื่อมั่นทางเศรษฐกิจ"],
  ["EU", /^Consumer Confidence/i, "ความเชื่อมั่นผู้บริโภคยูโรโซน"],
  ["EU", /^Unemployment Rate/i, "อัตราการว่างงานยูโรโซน"],
  ["EU", /^Retail Sales/i, "ยอดค้าปลีกยูโรโซน"],
  ["EU", /^Industrial Production/i, "การผลิตภาคอุตสาหกรรมยูโรโซน"],
  ["EU", /^Balance of Trade/i, "ดุลการค้ายูโรโซน"],
  ["EU", /^GDP Growth Rate/i, "อัตราการเติบโตเศรษฐกิจยูโรโซน"],
  ["EU", /^S&P Global Manufacturing PMI/i, "PMI ภาคการผลิตยูโรโซน (S&P Global)"],
  ["EU", /^S&P Global Services PMI/i, "PMI ภาคบริการยูโรโซน (S&P Global)"],
  ["EU", /^S&P Global Composite PMI/i, "PMI รวมยูโรโซน (S&P Global)"],

  // ---------- จีน ----------
  ["CN", /^NBS Manufacturing PMI/i, "PMI ภาคการผลิตจีน (ทางการ NBS)"],
  ["CN", /^NBS Non ?Manufacturing PMI/i, "PMI นอกภาคการผลิตจีน (ทางการ NBS)"],
  ["CN", /^RatingDog Manufacturing PMI|^Caixin Manufacturing/i, "PMI ภาคการผลิตจีน (ภาคเอกชน)"],
  ["CN", /^RatingDog Services PMI|^Caixin Services/i, "PMI ภาคบริการจีน (ภาคเอกชน)"],
  ["CN", /^Loan Prime Rate 1Y/i, "ดอกเบี้ยเงินกู้อ้างอิง LPR 1 ปี"],
  ["CN", /^Loan Prime Rate 5Y/i, "ดอกเบี้ยเงินกู้อ้างอิง LPR 5 ปี"],
  ["CN", /^New Yuan Loans/i, "ยอดปล่อยกู้ใหม่สกุลหยวน"],
  ["CN", /^Retail Sales/i, "ยอดค้าปลีกจีน"],
  ["CN", /^Industrial Production/i, "การผลิตภาคอุตสาหกรรมจีน"],
  ["CN", /^Fixed Asset Investment/i, "การลงทุนในสินทรัพย์ถาวร"],
  ["CN", /^House Price Index/i, "ดัชนีราคาบ้านจีน"],
  ["CN", /^Inflation Rate/i, "อัตราเงินเฟ้อจีน"],
  ["CN", /^PPI\b/i, "ดัชนีราคาผู้ผลิตจีน"],
  ["CN", /^Balance of Trade/i, "ดุลการค้าจีน"],
  ["CN", /^Exports/i, "มูลค่าส่งออกจีน"],
  ["CN", /^Imports/i, "มูลค่านำเข้าจีน"],
  ["CN", /^GDP Growth Rate/i, "อัตราการเติบโตเศรษฐกิจจีน (GDP)"],
  ["CN", /^Unemployment Rate/i, "อัตราการว่างงานจีน"],

  // ---------- ทั่วไป ----------
  [null, /Holiday/i, "วันหยุดตลาด"],
];

// ชื่อกรรมการธนาคารกลางเป็นชื่อเฉพาะ จับหลังจากตารางแปลไม่เจอแล้วเท่านั้น
const SPEECH_US = /^Fed (.+?) Speech$/i;
const SPEECH_EU = /^ECB (.+?) Speech$/i;

export function isNoise(event: Pick<CalendarEvent, "title">): boolean {
  return NOISE.test(event.title || "");
}

/** คืนชื่อไทยของข่าว หรือ "" ถ้ายังไม่มีคำแปล */
export function thaiTitle(event: Pick<CalendarEvent, "title" | "country">): string {
  const title = event.title || "";
  const country = event.country || "";

  let base = "";
  for (const [ruleCountry, pattern, thai] of TITLES) {
    if (ruleCountry !== null && ruleCountry !== country) continue;
    if (pattern.test(title)) {
      base = thai;
      break;
    }
  }

  if (!base && country === "US") {
    const m = SPEECH_US.exec(title);
    if (m) base = `กรรมการเฟด ${m[1]} แถลง`;
  }
  if (!base && country === "EU") {
    const m = SPEECH_EU.exec(title);
    if (m) base = `กรรมการ ECB ${m[1]} แถลง`;
  }
  if (!base) return "";

  const notes = SUFFIXES.filter(([pattern]) => pattern.test(title)).map(([, thai]) => thai);
  return notes.length ? `${base} · ${notes.join(" · ")}` : base;
}

export const COUNTRY_TH: Record<string, string> = {
  US: "สหรัฐฯ", EU: "ยูโรโซน", CN: "จีน", GB: "อังกฤษ", JP: "ญี่ปุ่น",
  DE: "เยอรมนี", CH: "สวิส", CA: "แคนาดา", AU: "ออสเตรเลีย", NZ: "นิวซีแลนด์",
};
