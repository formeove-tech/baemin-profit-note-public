"use client";

import { useState } from "react";
import { Q } from "@/lib/engine/rational";
import { count, pct, won } from "@/lib/engine/format";
import type { ChannelResult, Scope } from "@/lib/engine/profit";
import type { CostSettings, Store } from "@/lib/dataset";
import { quickCalc, takeShare, weeklyCompare } from "@/lib/insights";
import { Help } from "./Help";

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** v9 ②: 평균 주문(객단가) 1건당 항목별 금액 — 하나로 묶지 않고 항목마다 따로 보여 준다 */
export function TakeShareLine({ result }: { result: ChannelResult }) {
  const t = takeShare(result);
  if (!t) return null;
  const n = (q: Q) => Number(q.mul(10).round()) / 10;
  // 광고비·구독료는 정산 항목이 아니라 따로 낸 돈이라 별도 칸으로 둔다 (입력돼 있을 때만)
  const adPerOrder = t.perOrderWithAd && t.perOrder ? t.perOrderWithAd.add(t.perOrder.mul(-1)) : null;
  const adPer100 = t.withAd ? t.withAd.add(t.per100.mul(-1)) : null;
  const cells = [
    ...t.parts.map((p) => ({ key: p.kind, label: p.label, perOrder: p.perOrder, per100: p.per100 })),
    ...(adPerOrder && adPer100 && adPerOrder.cmp(0) > 0 ? [{ key: "ad", label: "광고비·구독료", perOrder: adPerOrder, per100: adPer100 }] : []),
  ];
  return (
    <section className="card p-5">
      <div className="text-sm font-semibold muted">
        {t.avgTicket ? <>평균 주문 {won(t.avgTicket)} 중, 1건당 항목별 금액 </> : <>1건당 항목별 금액 </>}
        <Help>정산에서 항목마다 따로 빠지는 금액을 주문 수로 나눈 값이에요. 중개이용료는 주문을 연결해 주는 이용료, 결제수수료는 카드결제 등 결제에 드는 비용, 배달비는 배달 서비스 이용 금액이에요. 재료비·포장비·인건비는 들어 있지 않아요. 평균 주문은 할인을 뺀 매출을 주문 수로 나눈 값이에요(위 숫자들과 같은 기준).</Help>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
        {cells.map((c) => (
          <div key={c.key} className="rounded-lg p-3" style={{ background: "var(--soft)" }}>
            <dt className="text-sm muted">{c.label}</dt>
            <dd className="mt-1 text-2xl font-extrabold tracking-tight">{c.perOrder ? won(c.perOrder) : "-"}</dd>
            <dd className="text-xs muted">평균 주문의 {n(c.per100)}%</dd>
          </div>
        ))}
      </dl>
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

/** v9 ④: 숫자만 넣는 빠른 계산 — 어디에도 저장·전송하지 않는다. 항목은 합치지 않고 따로 넣고 따로 보여 준다 */
export function QuickCalc() {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ sales: "", orders: "", brokerage: "", payment: "", delivery: "" });
  type Key = keyof typeof v;
  const num = (s: string) => Number(s.replace(/[,\s원건]/g, ""));
  const feeKeys: Key[] = ["brokerage", "payment", "delivery"];
  const filled = feeKeys.some((k) => v[k]);
  const feeSum = feeKeys.reduce((a, k) => a + (v[k] ? num(v[k]) : 0), 0);
  const r = v.sales && v.orders && filled ? quickCalc({ sales: num(v.sales), orders: num(v.orders), takenByBaemin: feeSum }) : null;
  const bad = !!(v.sales && v.orders && filled) && !r;
  const orders = num(v.orders);
  const field = (key: Key, label: string, hint: string) => (
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
        내 숫자로 바로 보기 (가져오기 없이)
      </button>
    );
  const parts: { label: string; key: Key }[] = [
    { label: "플랫폼 중개이용료", key: "brokerage" },
    { label: "결제수수료", key: "payment" },
    { label: "배달비", key: "delivery" },
  ];
  return (
    <div className="mt-3 rounded-lg p-4" style={{ background: "var(--soft)" }}>
      <p className="text-sm font-semibold">한 달 숫자를 넣어 보세요</p>
      <p className="text-xs muted">배민 셀프서비스 &lsquo;정산내역&rsquo;에서 보이는 한 달 합계면 돼요. 모르는 항목은 비워 두세요. 넣은 숫자는 이 화면 안에서만 쓰고 저장하거나 보내지 않아요.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {field("sales", "한 달 매출 (원)", "예: 12,000,000")}
        {field("orders", "한 달 주문 수 (건)", "예: 600")}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {field("brokerage", "플랫폼 중개이용료 (원)", "예: 900,000")}
        {field("payment", "결제수수료 (원)", "예: 300,000")}
        {field("delivery", "배달비 (원)", "예: 1,500,000")}
      </div>
      {bad && <p className="mt-2 text-sm loss">숫자를 다시 확인해 주세요. 넣은 금액이 매출의 두 배를 넘거나 0 이하 숫자가 있어요.</p>}
      {r && (
        <div className="mt-3 grid grid-cols-1 gap-2 text-base">
          <div>
            평균 주문 <strong>{won(r.avgOrder)}</strong> 중, 1건당
          </div>
          <ul className="grid grid-cols-1 gap-1 md:grid-cols-3">
            {parts
              .filter((p) => v[p.key])
              .map((p) => (
                <li key={p.key}>
                  {p.label} <strong>{won(Q.of(Math.round(num(v[p.key]))).div(orders))}</strong>{" "}
                  <span className="muted">({pct(Q.of(Math.round(num(v[p.key]))).div(Math.round(num(v.sales))), 1)})</span>
                </li>
              ))}
          </ul>
          <p className="text-xs muted">
            재료비·포장비·인건비는 아직 안 뺐어요. 재료비·인건비까지 넣은 &lsquo;진짜 남는 돈&rsquo;은 자료 가져오기 후 처음 설정에서 계산돼요.
          </p>
        </div>
      )}
    </div>
  );
}
