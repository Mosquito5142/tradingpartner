import BehaviourPanel from "@/components/BehaviourPanel";
import TradeImport from "@/components/TradeImport";
import { Banner, Panel } from "@/components/ui";
import { loadAccount } from "@/lib/account";
import { analyseBehaviour } from "@/lib/behaviour";
import { isConfigured } from "@/lib/db";
import { fmtThb, loadFx, supportsThb, toThb } from "@/lib/fx";
import { thDateTime } from "@/lib/time";
import {
  accountCurrency, allTrades, groupStats, HOLD_BUCKETS, RISK_BUCKETS, summarize,
  type Trade, type TradeStats,
} from "@/lib/trades";

export const dynamic = "force-dynamic";

export const metadata = { title: "สมุดบันทึกเทรด" };

/** ใช้เมื่อยังไม่เคยนำเข้าไฟล์ที่มีหัวรายงาน — ปกติจะอ่านยอดจริงจากฐานข้อมูลแทน */
const FALLBACK_BALANCE = 1000;

interface Baht {
  /** null = ยังแปลงไม่ได้ (ไม่รู้สกุลเงินของบัญชี) */
  of: (amount: number) => number | null;
}

function StatTable({
  rows, first, baht,
}: { rows: (TradeStats & { label: string })[]; first: string; baht: Baht }) {
  if (!rows.length) return <p className="text-[13px] text-faint">ยังไม่มีข้อมูล</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-[12.8px]">
        <thead>
          <tr className="border-b border-line text-left text-[11.5px] text-faint">
            <th className="py-1.5 pr-3 font-normal">{first}</th>
            <th className="py-1.5 pr-3 font-normal">ไม้</th>
            <th className="py-1.5 pr-3 font-normal">ชนะ</th>
            <th className="py-1.5 pr-3 font-normal">กำไรสุทธิ</th>
            <th className="py-1.5 font-normal">Profit Factor</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-raise">
              <td className="py-2 pr-3">{r.label}</td>
              <td className="tnum py-2 pr-3 text-faint">{r.n}</td>
              <td className="tnum py-2 pr-3">
                <b className={r.winRate >= 50 ? "text-up" : "text-down"}>{r.winRate}%</b>
              </td>
              <td className="tnum py-2 pr-3">
                <b className={r.netProfit >= 0 ? "text-up" : "text-down"}>
                  {r.netProfit >= 0 ? "+" : ""}
                  {r.netProfit.toLocaleString()}
                </b>
                {baht.of(r.netProfit) !== null && (
                  <div className="text-[11px] text-faint">{fmtThb(baht.of(r.netProfit)!, true)}</div>
                )}
              </td>
              <td className="tnum py-2 text-muted">{r.profitFactor ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** กราฟแท่งแสดงการกระจายของ %เสี่ยงต่อไม้ — ให้เห็นไม้ที่เสี่ยงหนักด้วยตา */
function RiskChart({ trades }: { trades: Trade[] }) {
  const withRisk = trades.filter((t) => t.riskPct !== null) as (Trade & { riskPct: number })[];
  if (!withRisk.length) {
    return (
      <p className="text-[13px] text-faint">
        ยังคำนวณ %เสี่ยงไม่ได้ — ต้องมีทั้ง SL ในไฟล์ statement และยอดเงินในบัญชี
      </p>
    );
  }
  const noSl = trades.length - withRisk.length;
  const maxRisk = Math.max(...withRisk.map((t) => t.riskPct), 10);
  const sorted = [...withRisk].sort((a, b) => a.openTs - b.openTs);

  return (
    <div>
      <div className="flex h-24 items-end gap-px overflow-x-auto">
        {sorted.map((t) => {
          const h = Math.max(2, (t.riskPct / maxRisk) * 100);
          const hot = t.riskPct >= 10;
          return (
            <div
              key={t.ticket}
              title={`${thDateTime(t.openTs)} · เสี่ยง ${t.riskPct}% · ${t.profit >= 0 ? "+" : ""}${t.profit}`}
              style={{ height: `${h}%` }}
              className={`w-2 shrink-0 rounded-t-sm ${hot ? "bg-downx" : t.profit >= 0 ? "bg-upx" : "bg-[#8b94a3]"}`}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-faint">
        แต่ละแท่ง = 1 ไม้ เรียงตามเวลา · สูง = เสี่ยงมาก ·{" "}
        <span className="text-down">แดง = เสี่ยงเกิน 10% ของพอร์ตในไม้เดียว</span> ·
        สูงสุดที่เจอ {maxRisk.toFixed(1)}%
        {noSl > 0 && (
          <>
            {" "}
            ·{" "}
            <b className="text-[#ffb38a]">
              อีก {noSl} ไม้ไม่ได้ตั้ง SL จึงไม่มีแท่ง — ความเสี่ยงจริงของไม้พวกนั้นวัดไม่ได้
            </b>
          </>
        )}
      </p>
    </div>
  );
}

export default async function JournalPage() {
  if (!isConfigured()) {
    return (
      <Panel title="สมุดบันทึกเทรด">
        <Banner tone="soft">
          ยังไม่ได้ตั้งค่าฐานข้อมูล — ต้องมี <code className="text-[#c7cdd8]">TURSO_DATABASE_URL</code> ก่อน
        </Banner>
      </Panel>
    );
  }

  const [trades, fx, account] = await Promise.all([allTrades(), loadFx(), loadAccount()]);
  // ยอดเงินมาจากหัวรายงานที่นำเข้าล่าสุด — ไม่ฝังไว้ในโค้ดเพราะเปลี่ยนทุกครั้งที่เทรด
  const balance = account?.balance ?? FALLBACK_BALANCE;
  const total = summarize(trades);
  const closed = trades.filter((t) => t.closeTs !== null);

  // แปลงได้ต่อเมื่อรู้สกุลเงินของบัญชีจริง ๆ — เดาว่าเป็น USD แล้วผิดจะคลาดไป 100 เท่า
  const currency = account?.currency || accountCurrency(trades);
  const canThb = Boolean(currency) && supportsThb(currency);
  const baht = { of: (amount: number) => (canThb ? toThb(amount, currency, fx.thbPerUsd) : null) };
  const behaviour = analyseBehaviour(trades);

  return (
    <div className="flex flex-col gap-5">
      <TradeImport defaultBalance={balance} />

      {!trades.length ? (
        <Panel title="ยังไม่มีไม้ในสมุด">
          <p className="text-[13px] text-faint">
            นำเข้าไฟล์ statement หรือกรอกมือด้านบน แล้วหน้านี้จะสรุปให้ว่า
            <b className="text-[#c7cdd8]"> คุณทำเงินได้จากการเล่นแบบไหนกันแน่</b> —
            แยกตามเซสชัน ช่วงข่าว ระยะเวลาถือ และระดับความเสี่ยง
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="ภาพรวม">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
              {[
                ["จำนวนไม้", String(total.n), "", null],
                ["อัตราชนะ", `${total.winRate}%`, total.winRate >= 50 ? "text-up" : "text-down", null],
                ["กำไรสุทธิ", `${total.netProfit >= 0 ? "+" : ""}${total.netProfit.toLocaleString()}`,
                  total.netProfit >= 0 ? "text-up" : "text-down",
                  baht.of(total.netProfit) === null ? null : fmtThb(baht.of(total.netProfit)!, true)],
                ["กำไรเฉลี่ย/ขาดทุนเฉลี่ย", `${total.avgWin} / ${total.avgLoss}`, "",
                  baht.of(total.avgWin) === null
                    ? null
                    : `${fmtThb(baht.of(total.avgWin)!)} / ${fmtThb(baht.of(total.avgLoss)!)}`],
                ["Profit Factor", String(total.profitFactor ?? "—"),
                  (total.profitFactor ?? 0) >= 1 ? "text-up" : "text-down", null],
              ].map(([k, v, cls, sub]) => (
                <div key={k}>
                  <div className="text-[11.5px] text-faint">{k}</div>
                  <div className={`tnum text-[20px] font-bold ${cls}`}>{v}</div>
                  {sub && <div className="tnum text-[12px] text-muted">{sub}</div>}
                </div>
              ))}
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-faint">
              กำไรสุทธิรวมค่าคอมมิชชั่นและ swap แล้ว · Profit Factor = กำไรรวม ÷ ขาดทุนรวม
              (ต่ำกว่า 1 คือขาดทุนสุทธิ)
              <br />
              {canThb ? (
                <>
                  ตัวเลขเป็น <b className="text-[#c7cdd8]">{currency}</b>
                  {currency === "USC" && " (บัญชี cent — 100 USC = 1 ดอลลาร์)"} ·
                  แปลงเป็นบาทที่ <b className="text-[#c7cdd8]">1 USD = ฿{fx.thbPerUsd.toFixed(3)}</b>{" "}
                  จาก {fx.source}
                  {fx.stale && (
                    <b className="text-[#ffb38a]"> — ดึงเรตสดไม่ได้ กำลังใช้ค่าประมาณในโค้ด</b>
                  )}
                </>
              ) : (
                <b className="text-[#ffb38a]">
                  {currency
                    ? `ยังแปลงสกุล ${currency} เป็นบาทไม่ได้ — รองรับเฉพาะ USD และ USC`
                    : "ไม่รู้สกุลเงินของบัญชี จึงไม่แปลงเป็นบาทให้ — นำเข้าไฟล์ statement ใหม่อีกครั้งเพื่อให้ระบบอ่านสกุลเงินจากหัวรายงาน"}
                </b>
              )}
            </p>
          </Panel>

          <Panel
            title="รูปแบบการเล่นของคุณ"
            sub="อ่านได้ตั้งแต่ไม้ไม่กี่ไม้ เพราะเป็นคำบรรยายสิ่งที่ทำไปแล้ว ไม่ใช่การประมาณค่าขอบได้เปรียบ"
          >
            <BehaviourPanel b={behaviour} balance={balance} unit={currency || "หน่วยบัญชี"} />
          </Panel>

          <Panel
            title="ความเสี่ยงต่อไม้"
            sub="เรื่องนี้มีผลต่อผลลัพธ์ระยะยาวมากกว่าคุณภาพสัญญาณ — ชนะบ่อยแต่แพ้หนักครั้งเดียวก็จบได้"
          >
            <RiskChart trades={trades} />
            <div className="mt-4">
              <StatTable rows={groupStats(trades, RISK_BUCKETS)} first="ช่วง %เสี่ยง" baht={baht} />
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel title="แยกตามเซสชัน" sub="เวลาไทย — ดูว่าช่วงไหนคุณทำเงินได้จริง">
              <StatTable rows={groupStats(trades, (t) => t.sessionTag || "ไม่ทราบ")} first="เซสชัน" baht={baht} />
            </Panel>

            <Panel title="เทรดช่วงข่าว vs ไม่ใช่ช่วงข่าว" sub="นับว่าเปิดไม้ภายใน ±30 นาทีรอบข่าวใหญ่">
              <StatTable
                rows={groupStats(trades, (t) => (t.newsTag ? "ช่วงข่าว" : "ไม่ใช่ช่วงข่าว"))}
                first="ประเภท"
                baht={baht}
              />
            </Panel>

            <Panel title="แยกตามระยะเวลาถือ">
              <StatTable rows={groupStats(closed, HOLD_BUCKETS)} first="ถือนานแค่ไหน" baht={baht} />
            </Panel>

            <Panel title="แยกตามทิศทาง">
              <StatTable
                rows={groupStats(trades, (t) => (t.side === "buy" ? "Buy" : "Sell"))}
                first="ทิศทาง"
                baht={baht}
              />
            </Panel>
          </div>

          <Panel title={`ไม้ล่าสุด (${Math.min(trades.length, 30)} จาก ${trades.length})`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[11.5px] text-faint">
                    <th className="py-1.5 pr-3 font-normal">เวลาเปิด</th>
                    <th className="py-1.5 pr-3 font-normal">ทิศ</th>
                    <th className="py-1.5 pr-3 font-normal">ล็อต</th>
                    <th className="py-1.5 pr-3 font-normal">เข้า → ออก</th>
                    <th className="py-1.5 pr-3 font-normal">ถือ</th>
                    <th className="py-1.5 pr-3 font-normal">เสี่ยง</th>
                    <th className="py-1.5 pr-3 font-normal">R</th>
                    <th className="py-1.5 pr-3 font-normal">กำไร</th>
                    <th className="py-1.5 font-normal">บริบท</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 30).map((t) => (
                    <tr key={t.ticket} className="border-b border-raise">
                      <td className="tnum py-2 pr-3 whitespace-nowrap">{thDateTime(t.openTs)}</td>
                      <td className="py-2 pr-3">
                        <span className={t.side === "buy" ? "text-up" : "text-down"}>
                          {t.side === "buy" ? "Buy" : "Sell"}
                        </span>
                      </td>
                      <td className="tnum py-2 pr-3">{t.lots}</td>
                      <td className="tnum py-2 pr-3 whitespace-nowrap">
                        {t.openPrice} → {t.closePrice ?? "—"}
                      </td>
                      <td className="tnum py-2 pr-3 text-muted">{t.holdMin === null ? "—" : `${t.holdMin}น.`}</td>
                      <td className="tnum py-2 pr-3">
                        {t.riskPct === null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span className={t.riskPct >= 10 ? "text-down" : "text-muted"}>{t.riskPct}%</span>
                        )}
                      </td>
                      <td className="tnum py-2 pr-3 text-muted">{t.rMultiple ?? "—"}</td>
                      <td className="tnum py-2 pr-3">
                        <b className={t.profit >= 0 ? "text-up" : "text-down"}>
                          {t.profit >= 0 ? "+" : ""}
                          {t.profit}
                        </b>
                        {baht.of(t.profit) !== null && (
                          <div className="text-[11px] text-faint">{fmtThb(baht.of(t.profit)!, true)}</div>
                        )}
                      </td>
                      <td className="py-2 text-[11.5px] text-faint">
                        {t.sessionTag}
                        {t.newsTag && <span className="text-[#c0a060]"> · ข่าว: {t.newsTag}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}

      <p className="text-[12px] leading-relaxed text-faint">
        <b className="text-[#c0a060]">หมายเหตุ:</b> %เสี่ยงคำนวณจากระยะราคาเข้าถึง SL ที่ตั้งไว้ในออเดอร์
        (ระยะ × ล็อต × 100 ÷ ยอดเงิน) ถ้าไม่ได้ตั้ง SL ก็คำนวณไม่ได้ ·
        R = กำไรจริง ÷ เงินที่เสี่ยงไว้ ·
        ตัวเลขทั้งหมดเป็นการสรุปผลย้อนหลังจากข้อมูลที่คุณนำเข้าเอง
        <b> ไม่ใช่คำแนะนำการลงทุน</b>
      </p>
    </div>
  );
}
