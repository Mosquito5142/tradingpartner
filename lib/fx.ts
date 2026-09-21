/**
 * อัตราแลกเปลี่ยน USD -> THB
 *
 * มีไว้เพื่อให้ตัวเลขในสมุดเทรดจับต้องได้ — บัญชี cent บอกกำไรเป็น USC
 * ซึ่งอ่านแล้วไม่รู้สึกว่าเยอะหรือน้อย (1,118 USC ฟังดูเยอะ แต่จริง ๆ คือ ~฿373)
 *
 * ออกแบบให้พังแล้วไม่ลาก UI ลงไปด้วย: ถ้าดึงไม่ได้จะคืนค่าสำรองพร้อมธง stale
 * ให้หน้าเว็บบอกผู้ใช้ตรง ๆ ว่ากำลังใช้ค่าประมาณ ไม่ใช่เงียบแล้วโชว์เลขผิด
 */

/** ถ้าดึงไม่ได้ทั้งสองแหล่ง — ค่าคร่าว ๆ ณ ก.ย. 2026 ใช้ชั่วคราวเท่านั้น */
const FALLBACK_THB = 33.3;

/** เรตไม่ได้ขยับรายวินาที cache 6 ชั่วโมงก็เกินพอและไม่กวนต้นทาง */
const TTL = 6 * 3600;

export interface FxRate {
  /** 1 USD = กี่บาท */
  thbPerUsd: number;
  source: string;
  /** ใช้ค่าสำรองอยู่ไหม — ต้องบอกผู้ใช้ */
  stale: boolean;
}

async function fromErApi(): Promise<number> {
  const res = await fetch("https://open.er-api.com/v6/latest/USD", { next: { revalidate: TTL } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; rates?: Record<string, number> };
  const rate = body.rates?.THB;
  if (body.result !== "success" || typeof rate !== "number" || !Number.isFinite(rate)) {
    throw new Error("ไม่มีอัตรา THB ในผลลัพธ์");
  }
  return rate;
}

async function fromFrankfurter(): Promise<number> {
  const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB", {
    next: { revalidate: TTL },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, number> };
  const rate = body.rates?.THB;
  if (typeof rate !== "number" || !Number.isFinite(rate)) throw new Error("ไม่มีอัตรา THB");
  return rate;
}

/** ดึงเรต — ลองสองแหล่งก่อนยอมใช้ค่าสำรอง */
export async function loadFx(): Promise<FxRate> {
  for (const [source, fn] of [
    ["exchangerate-api", fromErApi],
    ["frankfurter (ECB)", fromFrankfurter],
  ] as const) {
    try {
      const thbPerUsd = await fn();
      // กันค่าเพี้ยนจากต้นทาง — บาทไม่เคยอยู่นอกช่วงนี้ในรอบหลายสิบปี
      if (thbPerUsd > 10 && thbPerUsd < 100) {
        return { thbPerUsd, source, stale: false };
      }
      console.warn(`[fx] ${source} ให้ค่าผิดปกติ: ${thbPerUsd}`);
    } catch (err) {
      console.warn(`[fx] ${source}: ${(err as Error).message}`);
    }
  }
  return { thbPerUsd: FALLBACK_THB, source: "ค่าสำรองในโค้ด", stale: true };
}

/**
 * สกุลเงินของบัญชีเทียบเป็น USD
 *
 * บัญชี cent ของโบรกเกอร์คิดยอดเป็นเศษร้อยของสกุลจริง — Exness ใช้ USC
 * ถ้าแปลงผิดตัวเลขจะเพี้ยนไป 100 เท่า จึงยอมแปลงเฉพาะสกุลที่รู้จักแน่ ๆ
 */
const TO_USD: Record<string, number> = {
  USD: 1,
  USC: 1 / 100,
};

export function supportsThb(currency: string): boolean {
  return currency.toUpperCase() in TO_USD;
}

/** แปลงยอดในสกุลของบัญชีเป็นบาท — null เมื่อยังไม่รองรับสกุลนั้น */
export function toThb(amount: number, currency: string, thbPerUsd: number): number | null {
  const factor = TO_USD[currency.toUpperCase()];
  if (factor === undefined) return null;
  return Math.round(amount * factor * thbPerUsd * 100) / 100;
}

/** "฿1,234.56" — ใส่เครื่องหมายบวกให้ด้วยเมื่อต้องการ */
export function fmtThb(value: number, signed = false): string {
  const sign = signed && value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}฿${Math.abs(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
