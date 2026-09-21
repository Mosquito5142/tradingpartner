"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * นำเข้าไม้เทรด — อัปโหลดไฟล์ statement หรือกรอกมือ
 * ทำทั้งสองทางเพราะบางโบรกเกอร์ export ไม่ได้ / ผู้ใช้อาจอยากเพิ่มทีละไม้
 */
export default function TradeImport({ defaultBalance }: { defaultBalance: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"file" | "manual">("file");
  const [balance, setBalance] = useState(String(defaultBalance));
  const [offset, setOffset] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const field = "w-full rounded-md border border-line2 bg-ink px-2 py-1.5 text-[13.5px] tnum text-text outline-none focus:border-[#3d6fb5]";
  const label = "flex flex-col gap-1 text-[11.5px] text-muted";

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: parseFloat(balance) || undefined, ...payload }),
      });
      const j = await res.json();
      if (j.ok) {
        const warn = j.warnings?.length ? ` · ${j.warnings.join(" · ")}` : "";
        setMsg({ ok: true, text: `นำเข้า ${j.imported} ไม้ (${j.format})${warn}` });
        router.refresh();
      } else {
        const hint = j.headers?.length ? ` — หัวตารางที่เจอ: ${j.headers.slice(0, 10).join(" | ")}` : "";
        const warn = j.warnings?.length ? ` · ${j.warnings.join(" · ")}` : "";
        setMsg({ ok: false, text: `${j.error}${warn}${hint}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: `ส่งข้อมูลไม่สำเร็จ: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  /**
   * MT5 ส่งออกรายงานเป็น UTF-16 (ไม่ใช่ UTF-8) — file.text() ถอดรหัสเป็น UTF-8 เสมอ
   * จึงได้ข้อความเพี้ยนทั้งไฟล์ ต้องดู BOM เองแล้วเลือก decoder ให้ถูก
   */
  async function decode(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const b = new Uint8Array(buf);
    let enc = "utf-8";
    if (b[0] === 0xff && b[1] === 0xfe) enc = "utf-16le";
    else if (b[0] === 0xfe && b[1] === 0xff) enc = "utf-16be";
    else {
      // ไม่มี BOM: UTF-16 ฝั่ง ASCII จะมีไบต์ 0x00 สลับทุกตัว ซึ่ง UTF-8 ไม่มีทางมี
      const probe = b.subarray(0, 400);
      const zeros = probe.reduce((n, x) => n + (x === 0 ? 1 : 0), 0);
      if (zeros > probe.length / 4) enc = b[0] === 0 ? "utf-16be" : "utf-16le";
    }
    return new TextDecoder(enc).decode(buf).replace(/^﻿/, "");
  }

  async function onFile(file: File) {
    const text = await decode(file);
    await send({ text, serverOffsetHours: parseFloat(offset) || 7 });
  }

  async function onManual(form: HTMLFormElement) {
    const d = new FormData(form);
    const num = (k: string) => {
      const v = d.get(k);
      return v ? Number(v) : undefined;
    };
    await send({
      manual: {
        symbol: String(d.get("symbol") || "XAUUSD"),
        side: String(d.get("side") || "buy"),
        lots: num("lots"),
        openTime: String(d.get("openTime") || ""),
        closeTime: String(d.get("closeTime") || ""),
        openPrice: num("openPrice"),
        closePrice: num("closePrice"),
        sl: num("sl"),
        profit: num("profit"),
        comment: String(d.get("comment") || ""),
      },
    });
    form.reset();
  }

  return (
    <div className="rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[15.5px] font-semibold text-[#c7cdd8]">เพิ่มไม้เทรด</h2>
        {(["file", "manual"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-full border px-3 py-1.5 text-[13px] ${
              mode === m
                ? "border-[#3d6fb5] bg-[#22314a] text-[#dbe6f7]"
                : "border-line2 bg-raise text-muted hover:border-[#4a5567]"
            }`}
          >
            {m === "file" ? "อัปโหลดไฟล์ statement" : "กรอกมือ"}
          </button>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <label className={label}>
          ยอดเงินในบัญชี (ใช้คิด %เสี่ยง)
          <input className={field} type="number" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </label>
        {mode === "file" && (
          <label className={label}>
            เวลาเซิร์ฟเวอร์โบรกฯ (GMT+)
            <input className={field} type="number" step="1" value={offset} onChange={(e) => setOffset(e.target.value)} />
          </label>
        )}
      </div>

      {mode === "file" ? (
        <div>
          <input
            type="file"
            accept=".htm,.html,.csv,.tsv,.txt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
            className="block w-full text-[13px] text-muted file:mr-3 file:rounded-md file:border-0 file:bg-[#22314a] file:px-3 file:py-1.5 file:text-[13px] file:text-[#dbe6f7] hover:file:bg-[#2a3c58]"
          />
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            MT4: คลิกขวาในแท็บ Account History → <b>Save as Report</b> ·
            MT5: แท็บ History → คลิกขวา → <b>Report</b> → HTML
            <br />
            <b>Exness = GMT+0</b> · โบรกอื่นส่วนใหญ่เป็น +2 หรือ +3 —
            เช็กได้จากนาฬิกาในหน้าต่าง Market Watch เทียบกับเวลาจริง
            (ถ้าตั้งผิด เวลาไม้จะเพี้ยนและป้ายเซสชัน/ช่วงข่าวจะผิดตาม
            แต่แก้แล้วนำเข้าใหม่ทับได้เลย ไม่เกิดรายการซ้ำ)
          </p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onManual(e.currentTarget);
          }}
          className="grid grid-cols-2 gap-2.5 sm:grid-cols-4"
        >
          <label className={label}>
            ทิศทาง
            <select name="side" className={field} defaultValue="buy">
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label className={label}>ล็อต<input name="lots" className={field} type="number" step="0.01" required /></label>
          <label className={label}>เวลาเปิด<input name="openTime" className={field} type="datetime-local" required /></label>
          <label className={label}>เวลาปิด<input name="closeTime" className={field} type="datetime-local" /></label>
          <label className={label}>ราคาเข้า<input name="openPrice" className={field} type="number" step="0.001" required /></label>
          <label className={label}>ราคาออก<input name="closePrice" className={field} type="number" step="0.001" /></label>
          <label className={label}>SL<input name="sl" className={field} type="number" step="0.001" /></label>
          <label className={label}>กำไร/ขาดทุน<input name="profit" className={field} type="number" step="0.01" required /></label>
          <label className={`${label} col-span-2`}>หมายเหตุ<input name="comment" className={field} type="text" /></label>
          <div className="col-span-2 flex items-end">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md border border-[#3d6fb5] bg-[#22314a] px-4 py-1.5 text-[13px] text-[#dbe6f7] disabled:opacity-50"
            >
              บันทึกไม้นี้
            </button>
          </div>
        </form>
      )}

      {busy && <p className="mt-2 text-[13px] text-muted">กำลังประมวลผล...</p>}
      {msg && (
        <p
          className={`mt-2 rounded-md border px-2.5 py-1.5 text-[12.5px] leading-relaxed ${
            msg.ok
              ? "border-[#1f4a32] bg-[#10291c] text-up"
              : "border-[#54331f] bg-[#2a1a12] text-[#ffb38a]"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
