import Link from "next/link";
import { Banner, Panel } from "@/components/ui";
import { equityCurve, loadAccount, lotProfile, wilson } from "@/lib/account";
import { analyseBehaviour, SHOCK_MOVE } from "@/lib/behaviour";
import { isConfigured } from "@/lib/db";
import { fmtThb, loadFx, supportsThb, toThb } from "@/lib/fx";
import { isNotifyConfigured } from "@/lib/notify";
import { allRecords } from "@/lib/reactions";
import { thDateTime } from "@/lib/time";
import { accountCurrency, allTrades, summarize } from "@/lib/trades";

export const dynamic = "force-dynamic";

export const metadata = { title: "โปรไฟล์บัญชี" };

/** 1 ล็อต XAUUSD = 100 ออนซ์ */
const CONTRACT = 100;

function Stat({
  label, value, sub, tone = "",
}: { label: string; value: string; sub?: string | null; tone?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-faint">{label}</div>
      <div className={`tnum text-[19px] font-bold ${tone}`}>{value}</div>
      {sub && <div className="tnum text-[11.8px] text-muted">{sub}</div>}
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-raise py-1.5 last:border-0 text-[12.8px]">
      <span className="text-faint">{k}</span>
      <span className="text-right text-[#c7cdd8]">{v}</span>
    </div>
  );
}

export default async function ProfilePage() {
  if (!isConfigured()) {
    return (
      <Panel title="โปรไฟล์บัญชี">
        <Banner tone="soft">
          ยังไม่ได้ตั้งค่าฐานข้อมูล — ต้องมี <code className="text-[#c7cdd8]">TURSO_DATABASE_URL</code> ก่อน
        </Banner>
      </Panel>
    );
  }

  const [trades, account, fx, records] = await Promise.all([
    allTrades(), loadAccount(), loadFx(), allRecords(),
  ]);

  if (!trades.length && !account) {
    return (
      <Panel title="โปรไฟล์บัญชี">
        <Banner tone="soft">
          ยังไม่มีข้อมูล — นำเข้าไฟล์ statement ที่หน้า{" "}
          <Link href="/journal" className="text-[#7fb3ff] underline">
            สมุดเทรด
          </Link>{" "}
          ก่อน แล้วหน้านี้จะดึงยอดเงินและข้อมูลบัญชีจากหัวรายงานให้เอง
        </Banner>
      </Panel>
    );
  }

  const currency = account?.currency || accountCurrency(trades);
  const unit = currency || "หน่วย";
  const canThb = Boolean(currency) && supportsThb(currency);
  const baht = (n: number | null) =>
    n === null || !canThb ? null : toThb(n, currency, fx.thbPerUsd);
  const bahtStr = (n: number | null, signed = false) => {
    const v = baht(n);
    return v === null ? null : fmtThb(v, signed);
  };

  const total = summarize(trades);
  const balance = account?.balance ?? null;
  // ทุนเริ่มต้น = ยอดปัจจุบัน ลบกำไรสะสม — ใช้คิด % การเติบโตโดยไม่ต้องรู้ยอดฝาก
  const startBalance = balance === null ? null : balance - total.netProfit;
  const eq = equityCurve(trades, startBalance ?? 0);
  const lots = lotProfile(trades);
  const behaviour = analyseBehaviour(trades);
  const [lo, hi] = wilson(total.wins, total.n);
  const expectancy = total.n ? Math.round((total.netProfit / total.n) * 100) / 100 : 0;

  // ราคาสวนไปเท่าไหร่พอร์ตหมด ณ ขนาดที่ถือจริงสูงสุด
  const peakLots = behaviour?.overlap.peakLots ?? lots?.largest ?? 0;
  const wipeMove = balance && peakLots > 0 ? balance / (peakLots * CONTRACT) : null;
  const perDollar = peakLots > 0 ? peakLots * CONTRACT : null;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="โปรไฟล์บัญชี"
        sub="รวมทุกอย่างที่ควรรู้เกี่ยวกับบัญชีนี้ไว้หน้าเดียว — ดึงจากหัวรายงานและไม้ที่นำเข้า ไม่ได้ฝังค่าไว้ในโค้ด"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label={`ยอดเงิน (${unit})`}
            value={balance === null ? "—" : balance.toLocaleString()}
            sub={bahtStr(balance)}
          />
          <Stat
            label="กำไรสุทธิ"
            value={`${total.netProfit >= 0 ? "+" : ""}${total.netProfit.toLocaleString()}`}
            sub={bahtStr(total.netProfit, true)}
            tone={total.netProfit >= 0 ? "text-up" : "text-down"}
          />
          <Stat
            label="เติบโตจากทุนเริ่มต้น"
            value={
              startBalance && startBalance > 0
                ? `${total.netProfit >= 0 ? "+" : ""}${Math.round((total.netProfit / startBalance) * 1000) / 10}%`
                : "—"
            }
            sub={startBalance === null ? null : `ทุนตั้งต้น ${startBalance.toLocaleString()} ${unit}`}
            tone={total.netProfit >= 0 ? "text-up" : "text-down"}
          />
          <Stat
            label="กำไรเฉลี่ยต่อไม้"
            value={`${expectancy >= 0 ? "+" : ""}${expectancy.toLocaleString()}`}
            sub={bahtStr(expectancy, true)}
            tone={expectancy >= 0 ? "text-up" : "text-down"}
          />
        </div>

        {account && (
          <div className="mt-4 grid gap-x-6 sm:grid-cols-2">
            <div>
              {/* เลขบัญชีปิดบางส่วน — เว็บนี้เปิดสาธารณะ ไม่มีระบบล็อกอิน */}
              <Line k="เลขบัญชี" v={<code>•••{account.id.slice(-4)}</code>} />
              <Line k="โบรกเกอร์" v={account.company || "—"} />
              <Line k="เซิร์ฟเวอร์" v={account.server || "—"} />
            </div>
            <div>
              <Line
                k="ประเภท"
                v={
                  <>
                    {account.kind || "—"}
                    {account.mode && ` · ${account.mode}`}
                    {currency === "USC" && " · บัญชี cent"}
                  </>
                }
              />
              <Line
                k="สกุลเงิน"
                v={
                  <>
                    {currency || "ไม่ทราบ"}
                    {canThb && ` · 1 USD = ฿${fx.thbPerUsd.toFixed(3)}`}
                  </>
                }
              />
              <Line k="อัปเดตล่าสุด" v={thDateTime(account.updatedAt)} />
            </div>
          </div>
        )}
      </Panel>

      <Panel
        title="โอกาสชนะ"
        sub="อัตราชนะดิบบอกไม่พอ ต้องดูช่วงความเชื่อมั่นคู่กันเสมอ — ตัวอย่างน้อยทำให้ช่วงกว้างมาก"
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="จำนวนไม้" value={String(total.n)} />
          <Stat
            label="อัตราชนะ"
            value={`${total.winRate}%`}
            sub={`${total.wins} ชนะ / ${total.n - total.wins} แพ้`}
            tone={total.winRate >= 50 ? "text-up" : "text-down"}
          />
          <Stat
            label="ช่วงความเชื่อมั่น 95%"
            value={`${lo}–${hi}%`}
            sub={lo > 50 ? "ขอบล่างเกิน 50%" : "ยังคร่อม 50% — สรุปไม่ได้"}
            tone={lo > 50 ? "text-up" : "text-muted"}
          />
          <Stat
            label="Profit Factor"
            value={String(total.profitFactor ?? "—")}
            sub="กำไรรวม ÷ ขาดทุนรวม"
            tone={(total.profitFactor ?? 0) >= 1 ? "text-up" : "text-down"}
          />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-faint">
          ช่วง <b className="text-[#c7cdd8]">{lo}–{hi}%</b> คือขอบเขตที่อัตราชนะจริงน่าจะอยู่
          {lo <= 50 && (
            <>
              {" "}— เพราะยังคร่อม 50% อยู่ <b className="text-[#ffb38a]">
                จึงยังบอกไม่ได้ว่าคุณชนะเกินครึ่งจริงหรือแค่โชคดี
              </b>
            </>
          )}{" "}
          · ต้องเทรดอีกหลายสิบไม้ช่วงถึงจะแคบพอสรุปได้
        </p>
      </Panel>

      <Panel title="ความเสี่ยง" sub="ส่วนที่มีผลต่อผลลัพธ์ระยะยาวมากกว่าคุณภาพสัญญาณ">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="ถอยจากยอดสูงสุด (DD)"
            value={eq.maxDrawdown ? `-${eq.maxDrawdown.toLocaleString()}` : "—"}
            sub={eq.maxDrawdown ? `${eq.maxDrawdownPct}% ของพอร์ต ณ ตอนนั้น` : null}
            tone={eq.maxDrawdownPct >= 20 ? "text-down" : "text-muted"}
          />
          <Stat
            label="ไม้แย่สุด"
            value={behaviour ? behaviour.worstLoss.toLocaleString() : "—"}
            sub={behaviour ? bahtStr(behaviour.worstLoss, true) : null}
            tone="text-down"
          />
          <Stat
            label="แพ้ติดกันมากสุด"
            value={`${eq.longestLossStreak} ไม้`}
            sub={`ชนะติดกันมากสุด ${eq.longestWinStreak} ไม้`}
          />
          <Stat
            label="ล็อตล่าสุด / สูงสุด"
            value={lots ? `${lots.latest} / ${lots.largest}` : "—"}
            sub={lots?.growth ? `ล่าสุดโตกว่าค่ากลาง ${lots.growth} เท่า` : null}
            tone={lots?.growth && lots.growth >= 2 ? "text-down" : ""}
          />
        </div>

        {wipeMove !== null && perDollar !== null && (
          <div className="mt-4 rounded-md border border-[#54331f] bg-[#2a1a12] px-3 py-2 text-[12.5px] leading-relaxed text-[#ffb38a]">
            ที่ขนาดที่เคยถือจริงสูงสุด <b className="tnum">{peakLots}</b> ล็อต —
            ทองขยับ $1 = <b className="tnum">{perDollar.toLocaleString()} {unit}</b>
            {baht(perDollar) !== null && <> (<b className="tnum">{fmtThb(baht(perDollar)!)}</b>)</>} ·{" "}
            <b>ราคาสวนไป ${wipeMove.toFixed(2)} พอร์ตหมด</b> · เทียบกับที่วัดได้: ช่วงข่าวใหญ่สหรัฐฯ
            ราคาสวนไปถึง ${SHOCK_MOVE} ใน 10% ของครั้ง
          </div>
        )}

        {lots && lots.recent.length > 1 && (
          <p className="mt-2.5 text-[12px] leading-relaxed text-faint">
            ล็อต 5 ไม้ล่าสุด (เก่า → ใหม่):{" "}
            <b className="tnum text-[#c7cdd8]">{lots.recent.join(" → ")}</b>
            {/* เทียบกับค่ากลางของทั้งบัญชี ไม่ใช่แนวโน้มของ 5 ไม้นี้ — ต้องเขียนให้ตรงกับที่วัด */}
            {lots.growth && lots.growth >= 2 && (
              <b className="text-[#ffb38a]">
                {" "}— ใหญ่กว่าค่ากลางที่เคยใช้ทั้งบัญชี ({lots.median} ล็อต) อยู่ {lots.growth} เท่า
              </b>
            )}
          </p>
        )}
      </Panel>

      <Panel title="สิ่งที่ควรรู้" sub="สรุปจากแผงอื่นในเว็บ กดเข้าไปดูรายละเอียดได้">
        <div className="flex flex-col gap-1">
          {behaviour && (
            <>
              <Line
                k="เข้าใหม่หลังแพ้ vs หลังชนะ"
                v={
                  behaviour.reentry.medianAfterLoss === null
                    ? "ยังวัดไม่ได้"
                    : `${behaviour.reentry.medianAfterLoss} / ${behaviour.reentry.medianAfterWin} นาที`
                }
              />
              <Line
                k="ตั้ง SL"
                v={`${behaviour.withSl} / ${behaviour.n} ไม้`}
              />
              <Line
                k="ตัดกี่ไม้ที่ดีสุดแล้วพลิกเป็นขาดทุน"
                v={behaviour.concentration.flipsAt === null ? "ตัด 3 ไม้ยังบวก" : `${behaviour.concentration.flipsAt} ไม้`}
              />
            </>
          )}
          <Line k="ไม้ที่เทรดช่วงข่าว" v={`${trades.filter((t) => t.newsTag).length} / ${trades.length} ไม้`} />
          <Line k="คลังสถิติข่าว" v={`${records.length} รายการ`} />
          <Line
            k="แจ้งเตือน Telegram"
            v={isNotifyConfigured() ? <span className="text-up">เปิดใช้งาน</span> : <span className="text-faint">ยังไม่ได้ตั้งค่า</span>}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[12.5px]">
          {[
            ["/journal", "สมุดเทรด — รายละเอียดทุกไม้"],
            ["/lab", "Reaction Lab — สถิติข่าว"],
            ["/live", "โหมดข่าว"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="rounded-md border border-line2 bg-raise px-3 py-1.5 text-muted hover:border-[#4a5567] hover:text-text"
            >
              {label} →
            </Link>
          ))}
        </div>
      </Panel>

      <p className="text-[12px] leading-relaxed text-faint">
        ตัวเลขทั้งหมดคำนวณจากไม้ที่คุณนำเข้าเองและหัวรายงานของโบรกเกอร์ ·
        ยอดเงินเป็นค่า ณ เวลาที่ export ไม่ใช่เรียลไทม์ — export ใหม่แล้วนำเข้าทับเพื่ออัปเดต ·
        หน้านี้เปิดสาธารณะตามที่ตั้งใจไว้ เลขบัญชีจึงแสดงแค่ 4 ตัวท้าย ·
        <b> เป็นการสรุปสถิติย้อนหลัง ไม่ใช่คำแนะนำการลงทุน</b>
      </p>
    </div>
  );
}
