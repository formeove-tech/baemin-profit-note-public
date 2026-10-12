"use client";

import { useState } from "react";
import { Q } from "@/lib/engine/rational";
import { count, pct, won } from "@/lib/engine/format";
import type { ChannelResult, Scope } from "@/lib/engine/profit";
import type { CostSettings, Store } from "@/lib/dataset";
import { quickCalc, takeShare, weeklyCompare } from "@/lib/insights";
import { Help } from "./Help";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** v9 ②: 평균 주문(객단가) 1건당 배민에 내는 수수료·비용 — 큰 숫자 한 줄 */
export function TakeShareLine({ result }: { result: ChannelResult }) {
  const t = takeShare(result);
  if (!t) return null;
  const n = (q: Q) => Number(q.mul(10).round()) / 10;
  return (
    <section className="card p-5">
      <div className="text-sm font-semibold muted">
        {t.avgTicket ? (
          <>
            평균 주문 {won(t.avgTicket)} 중, 1건당 배민에 내는 수수료·비용{" "}
          </>
        ) : (
          <>배민에 내는 수수료·비용 </>
        )}
        <Help>중개이용료·결제수수료·배달비·그 부가세 등 배민 정산에서 빠지는 비용의 합이에요. 재료비·포장비·인건비는 들어 있지 않아요. 평균 주문은 할인을 뺀 매출을 주문 수로 나눈 값이에요(위 숫자들과 같은 기준).</Help>
      </div>
      <div className="mt-1 text-4xl font-extrabold tracking-tight md:text-5xl">{t.perOrder ? won(t.perOrder) : `${n(t.per100)}%`}</div>
      <p className="mt-1 text-base">
        평균 주문의 <strong>{n(t.per100)}%</strong>예요.{" "}
        {t.perOrderWithAd && (
          <span className="muted">
            광고비·구독료까지 넣으면 1건당 <strong>{won(t.perOrderWithAd)}</strong> ({n(t.withAd ?? t.per100)}%)
          </span>
        )}
      </p>
    </section>
  );
}

/** v9 ①: 최근 7일 vs 그 전 7일 — 한 줄 요약과 복사 */
export function WeekCompareLine({ store, settings, scope }: { store: Store; settings: CostSettings; scope: Scope }) {
  const [copied, setCopied] = useState(false);
  const w = weeklyCompare(store, settings, scope);
  if (!w) return null;
  const up = w.diff.cmp(0) >= 0;
  const text = `최근 7일(${md(w.cur.start)}~${md(w.cur.end)}) 배민으로 남은 돈 ${won(w.cur.value)}, 그 전 7일(${md(w.prev.start)}~${md(w.prev.end)})보다 ${won(w.diff.cmp(0) < 0 ? w.diff.mul(-1) : w.diff)} ${up ? "많아요" : "적어요"}.`;
  return (
    <section className="card flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between">
      <p className="text-base">
        최근 7일 남은 돈 <strong>{won(w.cur.value)}</strong> · 그 전 7일보다{" "}
        <strong className={up ? "gain" : "loss"}>
          {won(w.diff.cmp(0) < 0 ? w.diff.mul(-1) : w.diff)} {up ? "많아요" : "적어요"}
        </strong>
        <span className="block text-xs muted">
          자료가 있는 날만 비교했어요({w.cur.days}일 · {w.prev.days}일). 요일·행사·광고에 따라 달라질 수 있어서 원인은 따로 살펴보세요.
        </span>
      </p>
      <button
        type="button"
        className="btn tap-target shrink-0"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          });
        }}
      >
        {copied ? "복사했어요" : "한 줄로 복사"}
      </button>
    </section>
  );
}

/** v9 ④: 숫자 3개만 넣는 빠른 계산 — 어디에도 저장·전송하지 않는다 */
export function QuickCalc() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ sales: "", orders: "", taken: "" });
  const num = (s: string) => Number(s.replace(/[,\s원건]/g, ""));
  const r = v.sales && v.orders && v.taken ? quickCalc({ sales: num(v.sales), orders: num(v.orders), takenByBaemin: num(v.taken) }) : null;
  const bad = !!(v.sales && v.orders && v.taken) && !r;
  const field = (key: "sales" | "orders" | "taken", label: string, hint: string) => (
    <label className="block text-sm">
      <span className="font-semibold">{label}</span>
      <input
        className="input mt-1 w-full"
        inputMode="numeric"
        placeholder={hint}
        value={v[key]}
        onChange={(e) => setV({ ...v, [key]: e.target.value })}
      />
    </label>
  );
  if (!open)
    return (
      <button className="btn tap-target mt-3" onClick={() => setOpen(true)}>
        내 숫자 3개로 바로 보기 (가져오기 없이)
      </button>
    );
  return (
    <div className="mt-3 rounded-lg p-4" style={{ background: "var(--soft)" }}>
      <p className="text-sm font-semibold">한 달 숫자 3개만 넣어 보세요</p>
      <p className="text-xs muted">배민 셀프서비스 &lsquo;정산내역&rsquo;에서 보이는 한 달 합계면 돼요. 넣은 숫자는 이 화면 안에서만 쓰고 저장하거나 보내지 않아요.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {field("sales", "한 달 매출 (원)", "예: 12,000,000")}
        {field("orders", "한 달 주문 수 (건)", "예: 600")}
        {field("taken", "배민에 낸 금액 합계 (원)", "수수료·배달비 등 모두 더한 값")}
      </div>
      {bad && <p className="mt-2 text-sm loss">숫자를 다시 확인해 주세요. 낸 금액이 매출의 두 배를 넘거나 0 이하 숫자가 있어요.</p>}
      {r && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-base md:grid-cols-2">
          <div className="md:col-span-2">
            평균 주문 <strong>{won(r.avgOrder)}</strong> 중, 1건당 배민에 내는 수수료·비용은 <strong>{won(r.takenPerOrder)}</strong> (<strong>{pct(r.per100.div(100), 1)}</strong>)
          </div>
          <div className="md:col-span-2">
            재료비·포장비·인건비를 빼기 전 남는 돈 <strong>{won(r.leftBeforeCosts)}</strong> ({count(Number(v.orders.replace(/\D/g, "")))} 기준)
          </div>
          <p className="text-xs muted md:col-span-2">재료비·인건비까지 넣은 &lsquo;진짜 남는 돈&rsquo;은 자료 가져오기 후 처음 설정에서 계산돼요.</p>
        </div>
      )}
    </div>
  );
}
