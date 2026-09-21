/**
 * นำเข้า/ลบ ไม้เทรด
 *
 *   POST  /api/trades           body: { text, balance?, serverOffsetHours? }  นำเข้าไฟล์ statement
 *   POST  /api/trades           body: { manual: {...}, balance? }             เพิ่มไม้ทีละไม้
 *   DELETE /api/trades                                                        ล้างทั้งหมด
 */

import { NextResponse } from "next/server";
import { isConfigured } from "@/lib/db";
import { parseStatement, type ParsedTrade } from "@/lib/mt5-import";
import { accountCurrency, allTrades, saveTrades, tagTrades } from "@/lib/trades";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ManualInput {
  symbol?: string;
  side?: string;
  lots?: number;
  openTime?: string;
  closeTime?: string;
  openPrice?: number;
  closePrice?: number;
  sl?: number;
  profit?: number;
  comment?: string;
}

/** แปลงค่าจากฟอร์มกรอกมือ — ใช้ datetime-local ซึ่งเป็นเวลาไทยของผู้ใช้ */
function fromManual(m: ManualInput): ParsedTrade | null {
  const toTs = (s?: string) => {
    if (!s) return null;
    const ms = Date.parse(`${s}:00Z`); // ตีความเป็นเวลาไทยแล้วลบ offset
    return Number.isFinite(ms) ? Math.floor(ms / 1000) - 7 * 3600 : null;
  };
  const openTs = toTs(m.openTime);
  if (openTs === null || !m.lots || !m.openPrice || m.profit === undefined) return null;

  return {
    ticket: `manual:${openTs}:${m.lots}:${m.openPrice}`,
    symbol: m.symbol || "XAUUSD",
    side: m.side === "sell" ? "sell" : "buy",
    lots: Number(m.lots),
    openTs,
    closeTs: toTs(m.closeTime),
    openPrice: Number(m.openPrice),
    closePrice: m.closePrice ? Number(m.closePrice) : null,
    sl: m.sl ? Number(m.sl) : null,
    tp: null,
    profit: Number(m.profit),
    commission: 0,
    swap: 0,
    comment: m.comment || "",
  };
}

export async function POST(request: Request) {
  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า TURSO_DATABASE_URL" }, { status: 503 });
  }

  let body: { text?: string; balance?: number; serverOffsetHours?: number; manual?: ManualInput };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "อ่าน body ไม่ได้" }, { status: 400 });
  }

  try {
    let parsed: ParsedTrade[] = [];
    let warnings: string[] = [];
    let headers: string[] = [];
    let format = "manual";
    let currency = "";

    if (body.manual) {
      const one = fromManual(body.manual);
      if (!one) {
        return NextResponse.json(
          { ok: false, error: "กรอกไม่ครบ — ต้องมีอย่างน้อย เวลาเปิด ล็อต ราคาเข้า และกำไร/ขาดทุน" },
          { status: 400 },
        );
      }
      parsed = [one];
      // กรอกมือไม่มีสกุลเงินมาด้วย — ใช้ของบัญชีที่นำเข้าไว้แล้ว ไม่งั้นแปลงเป็นบาทไม่ได้
      currency = accountCurrency(await allTrades());
    } else if (body.text) {
      const result = parseStatement(body.text, body.serverOffsetHours ?? 7);
      parsed = result.trades;
      warnings = result.warnings;
      headers = result.headers;
      format = result.format;
      currency = result.currency;
    } else {
      return NextResponse.json({ ok: false, error: "ไม่มีข้อมูลส่งมา" }, { status: 400 });
    }

    if (!parsed.length) {
      // บอกตรง ๆ ว่าเจอหัวตารางอะไร จะได้ debug รูปแบบไฟล์ที่ยังไม่รองรับได้
      return NextResponse.json({ ok: false, error: "ไม่พบไม้เทรดในไฟล์", warnings, headers, format });
    }

    const tagged = await tagTrades(parsed, body.balance, currency);
    const saved = await saveTrades(tagged);

    return NextResponse.json({
      ok: true, imported: tagged.length, format, currency, warnings, headers, ...saved,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  if (!isConfigured()) {
    return NextResponse.json({ ok: false, error: "ยังไม่ได้ตั้งค่า Turso" }, { status: 503 });
  }
  const { deleteAllTrades } = await import("@/lib/trades");
  await deleteAllTrades();
  return NextResponse.json({ ok: true });
}
