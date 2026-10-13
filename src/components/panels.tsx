"use client";

import { useEffect, useState } from "react";
import { Q } from "@/lib/engine/rational";
import { count, pct, won, wonShort } from "@/lib/engine/format";
import {
  type DateRange,
  type DatedCost,
  koreaToday,
  daysInclusive,
  monthRange,
  monthsBetween,
  type ProratedPart,
} from "@/lib/engine/period";
import { type ChannelResult, computeChannel, DEDUCTION_LABEL, type DeductionKind, headline as headlineFn, type Scope, SCOPE_LABEL } from "@/lib/engine/profit";
import type { BreakevenResult } from "@/lib/engine/breakeven";
import { simulatePrice } from "@/lib/engine/simulate";
import { aggregate as aggregateFn, type aggregate, type CostSettings, dailySeries, type MenuTotal, type Store, verifyStore, weekdayStats } from "@/lib/dataset";
import type { StoreDataFile } from "@/lib/realStore";
import { depositBasis } from "@/lib/insights";
import { Help } from "./Help";

type Coverage = ReturnType<typeof aggregate>["coverage"];
type Agg = ReturnType<typeof aggregate>;

const perOrder = (x: Q | null, n: number) => (x === null || n <= 0 ? null : x.div(n));
const tone = (x: Q | null) => (x === null ? "" : x.cmp(0) < 0 ? "loss" : "gain");

function missingReason(r: ChannelResult, scope: Scope): string | null {
  if (r.flags.cogsMissing) return "재료원가율을 넣으면 계산돼요.";
  if (r.flags.directMissing) return "광고비 같은 플랫폼 비용을 넣거나 '없음'을 눌러 주세요.";
  if (scope === "allocated" && r.flags.commonMissing) return "인건비·월세 중 배민 주문분을 넣으면 계산돼요.";
  return null;
}

function ScopeTags({ r, scope, commonZero = false }: { r: ChannelResult; scope: Scope; commonZero?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <span className="chip">{SCOPE_LABEL[scope]}</span>
      {r.flags.cogsEstimated && <span className="chip chip-warn">재료비는 원가율로 어림</span>}
      {r.flags.packagingMissing && <span className="chip chip-warn">포장비 빠짐</span>}
      {r.flags.hasUnclassified && <span className="chip chip-warn">확인이 필요한 정산 항목 있음</span>}
      {scope === "allocated" && commonZero && <span className="chip chip-warn">인건비·월세 0원으로 두심</span>}
      <span className="chip">세금 떼기 전</span>
    </div>
  );
}

export function CoverageNotice({ coverage, onFetch }: { coverage: Coverage; onFetch?: (r: DateRange) => void }) {
  if (coverage.complete) return null;
  const shown = coverage.missing.slice(0, 3);
  // v5: 빠진 구간 전체(처음~끝)를 한 번에 가져오게 한다. 이미 있는 날짜는 수집 쪽에서 덮어써도 같은 값이라 문제 없다.
  const whole: DateRange = { start: coverage.missing[0].start, end: coverage.missing[coverage.missing.length - 1].end };
  return (
    <div className="card mb-4 flex flex-wrap items-center justify-between gap-2 p-3 text-sm" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
      <div>
        <strong>가져온 자료가 있는 날만 더한 값이에요.</strong> 보고 싶은 {coverage.requestedDays}일 중 {coverage.coveredDays}일만 자료가
        있어요. 빈 날은 0원이나 어림값으로 채우지 않았어요.
        <div className="mt-1">
          자료 없는 기간:{" "}
          {shown.map((m) => (m.start === m.end ? m.start : `${m.start}~${m.end}`)).join(", ")}
          {coverage.missing.length > 3 ? ` 외 ${coverage.missing.length - 3}구간` : ""}
        </div>
      </div>
      {onFetch && (
        <button className="btn" onClick={() => onFetch(whole)}>
          이 기간 자료 가져오기
        </button>
      )}
    </div>
  );
}

export function HeadlineCards({
  result: r,
  head,
  scope,
  coverage,
  commonZero = false,
}: {
  result: ChannelResult;
  head: { period: Q | null; perOrder: Q | null; ratio: Q | null };
  scope: Scope;
  coverage?: Coverage;
  /** 인건비·월세를 '없어요(0원)'로 확인한 상태 — 진짜 남는 돈이 광고비까지 뺀 돈과 같아져서 표시해 준다 */
  commonZero?: boolean;
}) {
  const reason = missingReason(r, scope);
  // v4: 포장비가 빠진 채로 큰 숫자만 보이면 정확한 이익처럼 읽혀서, 제목에 빠진 것을 같이 적는다
  const suffix = r.flags.packagingMissing ? " (포장비 빼기 전)" : "";
  // v6: 3개월을 골랐는데 자료가 30일뿐이면 '선택 기간 전체'가 아니라 '자료가 있는 30일'이라고 적는다
  const partial = coverage && !coverage.complete;
  const periodTitle = partial ? `자료가 있는 ${coverage.coveredDays}일의 이익` : "선택 기간 전체 이익";
  const periodSub = partial ? `고른 ${coverage.requestedDays}일 중 ${coverage.coveredDays}일만 자료 있음` : coverage ? `${coverage.requestedDays}일 합계` : "선택 기간 합계";
  const cards = [
    { title: `주문 1건당 남는 금액${suffix}`, value: head.perOrder, sub: r.N > 0 ? `완료 주문 ${count(r.N)} 기준` : "완료 주문 없음" },
    { title: `${periodTitle}${suffix}`, value: head.period, sub: periodSub },
  ];
  return (
    <section className="grid gap-3 md:grid-cols-2">
      {cards.map((c) => (
        <div key={c.title} className="card flex flex-col gap-2 p-5">
          <div className="text-sm font-semibold muted">{c.title}</div>
          {c.value !== null ? (
            <>
              <div className={`text-4xl font-extrabold tracking-tight md:text-5xl ${tone(c.value)}`}>{won(c.value)}</div>
              {/* v4: 큰 금액은 '1,340만 원'처럼 같이 읽어 주고, 조건 문구는 본문 크기로 */}
              <div className="text-base">
                {wonShort(c.value) && <span className="font-semibold">{wonShort(c.value)} · </span>}
                할인 뺀 매출의 <strong>{pct(head.ratio)}</strong>
                <span className="muted"> · {c.sub}</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-extrabold muted">입력 필요</div>
              <div className="text-sm">{reason ?? (r.N === 0 ? "완료 주문이 없어 주문당 금액을 계산할 수 없어요." : "")}</div>
            </>
          )}
          <ScopeTags r={r} scope={scope} commonZero={commonZero} />
        </div>
      ))}
    </section>
  );
}

export function StatRow({ result: r, be, scope }: { result: ChannelResult; be: BreakevenResult; scope: Scope }) {
  const items = [
    { label: "완료 주문", value: count(r.N) },
    { label: "주문 금액 합계", value: won(r.G), sub: `할인 뺀 매출 ${won(r.R)}` },
    { label: "주문 1건 평균", value: won(perOrder(r.R, r.N)), sub: `할인 전 ${won(perOrder(r.G, r.N))}` },
    {
      label: scope === "direct" ? "광고비 뽑는 데 필요한 주문" : "본전이 되는 주문 수",
      value: be.status === "ok" ? count(be.orders) : be.status === "unrecoverable" ? "회수 불가" : "입력 필요",
      sub: be.status === "ok" && be.dailyOrders !== null ? `하루 ${count(be.dailyOrders)}` : undefined,
    },
  ];
  return (
    <section className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((it) => (
        <div key={it.label} className="card p-3">
          <div className="text-xs font-semibold muted">{it.label}</div>
          <div className="mt-1 text-lg font-bold">{it.value}</div>
          {it.sub && <div className="text-xs muted">{it.sub}</div>}
        </div>
      ))}
    </section>
  );
}

export function TopChecks({ result: r, coverage, scope, commonZero = false, demo = false }: { result: ChannelResult; coverage: Coverage; scope: Scope; commonZero?: boolean; demo?: boolean }) {
  const checks: string[] = [];
  if (scope === "allocated" && commonZero) checks.push("인건비·월세를 0원으로 두셨어요. 가게에 인건비·월세가 있다면 '자세히 보기 → 원가와 비용'에서 배민 주문분을 넣어야 진짜 남는 돈이 나와요.");
  if (r.flags.cogsMissing) checks.push("재료비를 넣으면 남는 돈을 계산할 수 있어요.");
  if (!coverage.complete)
    checks.push(
      demo
        ? `예시 자료는 ${coverage.coveredDays}일치만 있어요. 실제 가게에서는 빠진 날짜를 더 가져올 수 있어요.`
        : `선택 기간 중 ${coverage.requestedDays - coverage.coveredDays}일은 자료가 없어요. 그 날짜로 자료를 더 가져와 주세요.`,
    );
  if (r.flags.hasUnclassified) checks.push(`확인이 필요한 정산 항목 ${won(r.deductionsByKind.unclassified)}이 있어요. 배민 정산명세서에서 확인해 주세요.`);
  if (r.flags.packagingMissing) checks.push("포장비가 빠져 있어요. 주문당 포장비를 넣으면 더 정확해져요.");
  if (scope === "allocated" && r.flags.commonMissing) checks.push("인건비·월세 중 배민 주문분을 넣어야 진짜 남는 돈이 나와요.");
  if (!r.R.isZero()) {
    const kinds = (Object.keys(r.deductionsByKind) as DeductionKind[]).filter((k) => k !== "unclassified");
    const top = kinds.sort((a, b) => r.deductionsByKind[b].cmp(r.deductionsByKind[a]))[0];
    const amt = r.deductionsByKind[top];
    if (amt.isPositive())
      checks.push(
        `정산 항목 중 ${DEDUCTION_LABEL[top]}가 가장 커요: 주문 1건당 ${won(perOrder(amt, r.N))}, 할인 뺀 매출의 ${pct(r.R.isZero() ? null : amt.div(r.R))}.` +
          (top === "delivery" ? " 배달비는 배민 배달 방식에 따라 정해져요 — 사장님이 줄일 수 있는 건 할인·포장비·재료비예요." : ""),
      );
  }
  return (
    <section className="card mt-3 p-4">
      <h2 className="section">지금 눈여겨볼 것</h2>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
        {checks.slice(0, 3).map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
    </section>
  );
}

export function Waterfall({ result: r, cogsNote, commonNote }: { result: ChannelResult; cogsNote?: string; commonNote?: string }) {
  const n = r.N;
  type Row = { label: string; value: Q | null; kind: "base" | "cost" | "sum"; note?: string; help?: string };
  const DEDUCTION_HELP: Record<DeductionKind, string> = {
    brokerage: "주문을 연결해 주는 대가로 주문마다 내는 플랫폼 중개이용료예요 (배민배달·가게배달·포장 요율에 따라 달라요).",
    payment: "카드결제 등 결제·정산에 드는 결제수수료예요.",
    delivery: "배민이 배달해 주고 사장님께 받는 배달비예요.",
    other: "중개이용료·결제수수료·배달비에 붙는 부가세예요. 부가세 신고 때 돌려받을 수 있어서, 이 화면은 '세금 떼기 전' 기준으로 넣었어요.",
    unclassified: "배민 정산에는 있는데 이 프로그램이 아직 뜻을 모르는 항목이에요. 정산명세서에서 확인해 주세요.",
  };
  const rows: Row[] = [
    { label: "주문 금액", value: perOrder(r.G, n), kind: "base", help: "손님이 주문한 음식·옵션 값을 다 더한 금액이에요. 할인·수수료를 빼기 전이에요." },
    { label: "사장님이 낸 할인", value: perOrder(r.D, n), kind: "cost", help: "즉시할인·쿠폰처럼 사장님 돈으로 깎아 준 금액이에요. 배민이 대신 낸 할인은 여기 없어요." },
    { label: "할인 뺀 매출", value: perOrder(r.R, n), kind: "sum" },
    ...(r.otherRevenue.isZero()
      ? []
      : [
          {
            label: "손님이 낸 배달팁 (내 몫)",
            value: perOrder(r.otherRevenue, n),
            kind: "base" as const,
            help: "가게배달 주문에서 손님이 낸 배달팁 중 가게로 들어오는 돈이에요. 주문 1건 평균 금액에는 넣지 않았어요.",
          },
        ]),
    ...(Object.keys(r.deductionsByKind) as DeductionKind[])
      .filter((k) => !r.deductionsByKind[k].isZero())
      .map((k) => ({ label: DEDUCTION_LABEL[k], value: perOrder(r.deductionsByKind[k], n), kind: "cost" as const, help: DEDUCTION_HELP[k] })),
    // v6 QA: "40 넣었는데 41.5%?" → 넣은 값(판매가의 40%)을 그대로 보여 준다. 오른쪽 %는 할인 뺀 매출 기준이라 달라 보인다
    { label: "재료비", value: perOrder(r.cogs, n), kind: "cost", note: r.flags.cogsEstimated ? (cogsNote ?? "원가율로 어림") : undefined },
    {
      label: "포장비",
      value: r.flags.packagingMissing ? null : perOrder(r.packaging, n),
      kind: "cost",
      note: r.flags.packagingMissing ? "미입력" : undefined,
    },
    {
      label: "수수료·재료비 뺀 돈",
      value: perOrder(r.cm, n),
      kind: "sum",
      help: "주문 한 건을 팔면 들어오는 돈에서, 그 주문 때문에 나가는 돈(중개이용료·결제수수료·배달비·재료·포장)을 뺀 금액이에요. 여기서 광고비와 인건비·월세를 더 빼야 진짜 남는 돈이에요.",
    },
    {
      label: "광고비 (1건으로 나눈 값)",
      value: perOrder(r.directFixed, n),
      kind: "cost",
      note: r.flags.directMissing ? "모름" : undefined,
      help: "이 기간 광고비를 주문 수로 나눈 평균이에요. 주문이 늘면 1건당 광고비는 줄어들어요.",
    },
    { label: "광고비까지 뺀 돈", value: perOrder(r.direct, n), kind: "sum" },
    {
      label: "인건비·월세 몫 (1건으로 나눈 값)",
      value: perOrder(r.commonAllocated, n),
      kind: "cost",
      note: r.flags.commonMissing ? "입력 필요" : commonNote,
      help: "가게 전체 인건비·월세 중 배민에 해당하는 몫을 주문 수로 나눈 값이에요.",
    },
    { label: "진짜 남는 돈", value: perOrder(r.allocated, n), kind: "sum" },
  ];
  // v6: 비율 기준을 위쪽 큰 숫자와 같은 '할인 뺀 매출'로 통일 (GPT 검토: 기준이 둘이면 둘 다 이해해야 한다)
  const base = perOrder(r.R, n);
  const orderAmount = perOrder(r.G, n);
  return (
    <section className="card p-4">
      <h2 className="section">평균 주문 1건의 돈 흐름</h2>
      <p className="mt-1 text-xs muted">
        이 기간 전체를 주문 수로 나눈 평균이에요. 줄마다 <strong>?</strong> 를 누르면 무슨 뜻인지 나와요.
      </p>
      {base === null || base.isZero() || orderAmount === null ? (
        <p className="mt-3 text-sm">완료 주문이 없어요.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map((row) => {
            const w = row.value === null ? 0 : Math.min(100, Math.abs(row.value.div(orderAmount).toNumber()) * 100);
            const showPct = row.value !== null && row.label !== "주문 금액";
            const neg = row.value !== null && row.value.cmp(0) < 0;
            return (
              <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
                <div className="min-w-0">
                  <div className={`flex flex-wrap items-center gap-1.5 ${row.kind === "sum" ? "font-bold" : ""}`}>
                    <span>{row.label}</span>
                    {row.note && <span className="chip chip-warn">{row.note}</span>}
                    {row.help && <Help>{row.help}</Help>}
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full" style={{ background: "var(--soft)" }}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${w}%`,
                        background: row.kind === "cost" || neg ? "var(--bar-cost)" : "var(--bar)",
                      }}
                    />
                  </div>
                </div>
                <div className={`text-right ${row.kind === "sum" ? "font-bold" : ""} ${neg ? "loss" : ""}`}>
                  {row.value === null ? "—" : row.kind === "cost" ? `−${won(row.value)}` : won(row.value)}
                  <div className="text-xs font-normal muted">
                    {showPct ? pct(row.value!.div(base)) : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-sm muted">오른쪽 %는 모두 <strong>할인 뺀 매출</strong> 기준이에요 (위쪽 큰 숫자와 같은 기준).</p>
    </section>
  );
}

function NumField({
  value,
  onChange,
  placeholder,
  suffix,
  label,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder?: string;
  suffix?: string;
  label: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <input
          className="input"
          inputMode="decimal"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.]/g, "");
            setText(t);
            if (t === "") onChange(null);
            else if (/^\d+(\.\d+)?$/.test(t)) onChange(Number(t));
          }}
        />
        {suffix && <span className="shrink-0 muted">{suffix}</span>}
      </span>
    </label>
  );
}

function CostList({
  title,
  parts,
  costs,
  onRemove,
  noneLabel,
  none,
  onNone,
}: {
  title: string;
  parts: ProratedPart[];
  costs: DatedCost[];
  onRemove: (id: string) => void;
  noneLabel: string;
  none: boolean;
  onNone: (v: boolean) => void;
}) {
  const total = Q.sum(parts.map((p) => p.share));
  const [showAuto, setShowAuto] = useState(false);
  const autoCosts = costs.filter((c) => c.id.startsWith("auto-"));
  const autoInRange = parts.filter((p) => p.cost.id.startsWith("auto-"));
  const manual = costs.filter((c) => !c.id.startsWith("auto-"));
  const visible = showAuto ? costs : manual;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>{title}</span>
        <span>{costs.length || none ? won(total) : "입력 필요"}</span>
      </div>
      {autoCosts.length > 0 && (
        <div className="flex items-center justify-between rounded-lg p-2 text-xs" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <span>
            배민에서 자동으로 가져온 비용 {autoCosts.length}건 · 선택 기간 {won(Q.sum(autoInRange.map((p) => p.share)))}
          </span>
          <button className="tap-target underline" onClick={() => setShowAuto((v) => !v)}>
            {showAuto ? "접기" : "자세히"}
          </button>
        </div>
      )}
      {visible.length === 0 && costs.length === 0 ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={none} onChange={(e) => onNone(e.target.checked)} />
          {noneLabel}
        </label>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {visible.map((c) => {
            const p = parts.find((x) => x.cost.id === c.id);
            return (
              <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg p-2" style={{ background: "var(--soft)" }}>
                <span className="min-w-0">
                  <span className="font-semibold">{c.label}</span> {won(c.amount)} ({c.start}~{c.end})
                  <br />
                  <span className="muted">
                    {p ? `이번 기간 몫 ${won(p.share)} (${p.costDays}일 중 ${p.overlapDays}일)` : "지금 보는 기간과 상관없음"}
                  </span>
                </span>
                <button className="tap-target shrink-0 underline muted" onClick={() => onRemove(c.id)}>
                  삭제
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * 공통비 배분 도우미 (CALC 05).
 * 가게 전체 비용에서 배민 주문분만 떼어 낸다. 배민 매출만으로 비율을 추정하지 않고,
 * 사장님이 비율을 직접 정하거나 전체 매출을 넣어 계산하게 한다.
 */
function CommonCostHelper({
  range,
  baeminSales,
  onAdd,
}: {
  range: DateRange;
  baeminSales: Q;
  onAdd: (costs: DatedCost[]) => void;
}) {
  const [items, setItems] = useState<{ label: string; amount: string }[]>([
    { label: "인건비", amount: "" },
    { label: "월세", amount: "" },
    { label: "공과금(전기·가스·수도)", amount: "" },
  ]);
  const [mode, setMode] = useState<"ratio" | "sales">("ratio");
  const [ratio, setRatio] = useState<number | null>(50);
  // 홀 매출(배민 제외). 배민 매출은 앱이 알고 있으니 더해서 비율을 계산한다. 쿠팡이츠 등 다른 앱은 성과 공유 이후 업그레이드에서 따로 다룬다
  const [otherSales, setOtherSales] = useState<number | null>(null);
  const [fromMonth, setFromMonth] = useState(range.start.slice(0, 7));
  const [toMonth, setToMonth] = useState(range.end.slice(0, 7));

  const monthlyTotal = Q.sum(items.map((i) => Number(i.amount.replace(/[^\d]/g, "")) || 0));
  // 매출 비중으로 나눌 때는 같은 기간의 홀·다른 앱 매출이 있어야 한다 (배민 매출만으로 추정하지 않음). 없으면 0원을 넣는다
  const salesRatio = mode === "sales" && otherSales !== null && !baeminSales.add(otherSales).isZero() ? baeminSales.div(baeminSales.add(otherSales)) : null;
  const applied = mode === "ratio" ? (ratio === null ? null : Q.pct(ratio)) : salesRatio;
  const share = applied === null ? null : monthlyTotal.mul(applied);
  const months = fromMonth <= toMonth ? monthsBetween(fromMonth, toMonth) : [];
  const valid = share !== null && !share.isZero() && months.length > 0;

  return (
    <details className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--line)" }}>
      <summary className="cursor-pointer font-semibold">＋ 인건비·월세 넣기 (배민 주문이 쓴 만큼만 계산)</summary>
      <p className="mt-2 text-xs muted">
        가게 전체로 한 달에 드는 비용을 적어 주세요. 홀도 같이 하는 가게라면, 그중 배민 주문이 쓴 비율만큼만 넣어요. 배민 배달만 하는 가게라면 100%를 누르세요.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <input
              className="input"
              placeholder="항목 (예: 인건비)"
              value={it.label}
              onChange={(e) => setItems((v) => v.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <input
              className="input w-40"
              inputMode="numeric"
              placeholder="한 달 금액(원)"
              value={it.amount}
              onChange={(e) => setItems((v) => v.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            />
          </div>
        ))}
        <button className="btn self-start" onClick={() => setItems((v) => [...v, { label: "", amount: "" }])}>
          항목 추가
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <div className="seg self-start" role="group" aria-label="배분 방법">
          <button aria-pressed={mode === "ratio"} onClick={() => setMode("ratio")}>
            비율 직접 정하기
          </button>
          <button aria-pressed={mode === "sales"} onClick={() => setMode("sales")}>
            매출 비중으로
          </button>
        </div>
        {mode === "ratio" ? (
          <div className="flex flex-col gap-2">
            <div className="w-44">
              <NumField label="배민 주문이 쓴 비율" value={ratio} suffix="%" onChange={setRatio} />
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="btn tap-target" onClick={() => setRatio(100)}>
                배민만 해요 (100%)
              </button>
              <button className="btn tap-target" onClick={() => setRatio(50)}>
                절반 (50%)
              </button>
            </div>
            {(ratio === null || ratio === 0) && monthlyTotal.cmp(0) > 0 && (
              <p className="text-xs loss">비율이 0%라서 0원이 들어가요. 배민 배달만 하는 가게면 위의 '배민만 해요 (100%)' 버튼을 눌러 주세요.</p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="w-56">
              <NumField
                label="홀 매출 (배민 빼고, 같은 기간)"
                value={otherSales}
                suffix="원"
                placeholder="예: 홀 매출 합계 (없으면 0)"
                onChange={(v) => setOtherSales(v === null ? null : Math.round(v))}
              />
            </div>
            <p className="text-xs muted">홀의 판매가·재료비·광고비는 따로예요. 홀 매출은 여기서 인건비·월세를 나누는 데만 쓰고, 배민 손익은 배민 주문 자료로만 계산해요.</p>
            <p className="text-xs muted">
              선택 기간 배민 매출 {won(baeminSales)} ÷ (배민 매출 + 홀 매출 {won(otherSales ?? 0)}) = 배민 주문 비율{" "}
              {salesRatio === null ? "홀 매출을 넣어 주세요 (없으면 0)" : pct(salesRatio)}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="muted">적용 기간</span>
          <input type="month" className="input w-auto" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
          <span>~</span>
          <input type="month" className="input w-auto" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
        </div>
      </div>

      <p className="mt-3 text-sm">
        가게 전체 한 달 {won(monthlyTotal)} × 배민 주문 비율 {applied === null ? "—" : pct(applied)} ={" "}
        <strong>{share === null ? "—" : won(share)}</strong> <span className="muted">/ 월 · {months.length}개월 적용</span>
      </p>
      <button
        className="btn btn-primary mt-2"
        disabled={!valid}
        style={{ opacity: valid ? 1 : 0.5 }}
        onClick={() => {
          if (!valid || share === null) return;
          const id = Math.random().toString(36).slice(2, 8);
          onAdd(
            months.map((m) => ({
              id: `${id}-${m}`,
              label: `인건비·월세 배민 주문분 (${Number(m.slice(5))}월, 전체 ${won(monthlyTotal)}의 ${pct(applied!)})`,
              amount: Number(share.round()),
              ...monthRange(m),
            })),
          );
        }}
      >
        이 금액으로 넣기
      </button>
    </details>
  );
}

function AddCostForm({ range, onAdd }: { range: DateRange; onAdd: (kind: "direct" | "common", costs: DatedCost[]) => void }) {
  const [kind, setKind] = useState<"direct" | "common">("common");
  const [type, setType] = useState<"month" | "range">("month");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [fromMonth, setFromMonth] = useState(range.start.slice(0, 7));
  const [toMonth, setToMonth] = useState(range.end.slice(0, 7));
  const [start, setStart] = useState(range.start);
  const [end, setEnd] = useState(range.end);
  const amt = Number(amount.replace(/[^\d]/g, ""));
  const valid = label.trim() && amt > 0 && (type === "month" ? fromMonth <= toMonth : start <= end);

  function submit() {
    if (!valid) return;
    const id = Math.random().toString(36).slice(2, 8);
    const costs =
      type === "month"
        ? monthsBetween(fromMonth, toMonth).map((m) => ({
            id: `${id}-${m}`,
            label: `${label.trim()} (${m})`,
            amount: amt,
            ...monthRange(m),
          }))
        : [{ id, label: label.trim(), amount: amt, start, end }];
    onAdd(kind, costs);
    setLabel("");
    setAmount("");
  }

  return (
    <details className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--line)" }}>
      <summary className="cursor-pointer font-semibold">+ 기간 비용 추가</summary>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "direct" | "common")}>
          <option value="common">인건비·월세 중 배민 주문분</option>
          <option value="direct">배민 전용 비용 (정액 광고 등)</option>
        </select>
        <input className="input" placeholder="항목 이름" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select className="input" value={type} onChange={(e) => setType(e.target.value as "month" | "range")}>
          <option value="month">매월 같은 금액</option>
          <option value="range">특정 기간 총액</option>
        </select>
        <input
          className="input"
          inputMode="numeric"
          placeholder={type === "month" ? "월 금액(원)" : "기간 총액(원)"}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {type === "month" ? (
          <>
            <input type="month" className="input" value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} />
            <input type="month" className="input" value={toMonth} onChange={(e) => setToMonth(e.target.value)} />
          </>
        ) : (
          <>
            <input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} />
            <input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} />
          </>
        )}
      </div>
      <p className="mt-2 text-xs muted">
        선택 기간과 겹치는 날짜만큼 달력 일수로 나눠 반영해요. 월 비용을 기간 길이만큼 곱하지 않아요.
      </p>
      <button className="btn btn-primary mt-2" disabled={!valid} onClick={submit} style={{ opacity: valid ? 1 : 0.5 }}>
        추가
      </button>
    </details>
  );
}

/** v4: %를 모르는 사장님을 위해, 대표 메뉴 한 그릇의 판매가·재료비(원)로 원가율을 계산해 넣는다 */
function RateFromDish({ onPick }: { onPick: (ratePct: number) => void }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const p = Number(price) || 0;
  const c = Number(cost) || 0;
  const rate = p > 0 && c > 0 && c < p ? Math.round((c / p) * 1000) / 10 : null;
  if (!open)
    return (
      <button className="tap-target self-start text-xs underline muted" onClick={() => setOpen(true)}>
        %를 몰라요 — 대표 메뉴 한 그릇으로 계산하기
      </button>
    );
  return (
    <div className="rounded-lg p-2 text-xs" style={{ background: "var(--soft)" }}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span>한 그릇 판매가 (원)</span>
          <input className="input w-28" inputMode="numeric" placeholder="예: 10000" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <label className="flex flex-col gap-1">
          <span>한 그릇 재료비 (원)</span>
          <input className="input w-28" inputMode="numeric" placeholder="예: 3000" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <button
          className="btn btn-primary"
          disabled={rate === null}
          onClick={() => {
            if (rate !== null) {
              onPick(rate);
              setOpen(false);
            }
          }}
        >
          {rate === null ? "넣기" : `${rate}%로 넣기`}
        </button>
      </div>
    </div>
  );
}

export function CostPanel({
  settings: s,
  onChange,
  agg,
  range,
  baeminSales,
}: {
  settings: CostSettings;
  onChange: (p: Partial<CostSettings>) => void;
  agg: Agg;
  range: DateRange;
  baeminSales: Q;
}) {
  return (
    <section className="card flex flex-col gap-4 p-4">
      <div>
        <h2 className="section">원가와 비용</h2>
        <p className="mt-1 text-xs muted">
          이 가게에만 적용돼요. 비워 둔 비용은 0원으로 치지 않고 &lsquo;입력 필요&rsquo;로 표시해요.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <NumField
            label="전체 재료원가율"
            value={s.cogs.ratePct}
            suffix="%"
            placeholder="예: 30"
            onChange={(v) => onChange({ cogs: { ...s.cogs, ratePct: v } })}
          />
          <RateFromDish onPick={(v) => onChange({ cogs: { ...s.cogs, ratePct: v } })} />
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">원가율은 무엇의 몇 %인가요</span>
          <select
            className="input"
            value={s.cogs.base}
            onChange={(e) => onChange({ cogs: { ...s.cogs, base: e.target.value as "gross" | "net" } })}
          >
            <option value="gross">메뉴 판매가(할인 전)의 %</option>
            <option value="net">할인 뺀 금액의 %</option>
          </select>
        </label>
        <NumField
          label="주문 1건당 포장비"
          value={s.packagingPerOrder}
          suffix="원"
          placeholder="모르면 비워 두세요"
          onChange={(v) => onChange({ packagingPerOrder: v === null ? null : Math.round(v) })}
        />
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            checked={s.cogs.includesPackaging}
            onChange={(e) => onChange({ cogs: { ...s.cogs, includesPackaging: e.target.checked } })}
          />
          원가율에 포장비가 이미 들어 있어요
        </label>
      </div>
      <CostList
        title="광고비 등 배민에만 드는 비용"
        parts={agg.directParts}
        costs={s.directCosts}
        onRemove={(id) => onChange({ directCosts: s.directCosts.filter((c) => c.id !== id) })}
        noneLabel="배민 전용 고정 비용이 없어요 (0원 확인)"
        none={s.noDirectCosts}
        onNone={(v) => onChange({ noDirectCosts: v })}
      />
      <CostList
        title="인건비·월세 중 배민 주문분"
        parts={agg.commonParts}
        costs={s.commonCosts}
        onRemove={(id) => onChange({ commonCosts: s.commonCosts.filter((c) => c.id !== id) })}
        noneLabel="인건비·월세 배민 주문분이 정말 없어요 (0원)"
        none={s.noCommonCosts}
        onNone={(v) => onChange({ noCommonCosts: v })}
      />
      <CommonCostHelper range={range} baeminSales={baeminSales} onAdd={(costs) => onChange({ commonCosts: [...s.commonCosts, ...costs] })} />
      <AddCostForm
        range={range}
        onAdd={(kind, costs) =>
          kind === "direct"
            ? onChange({ directCosts: [...s.directCosts, ...costs] })
            : onChange({ commonCosts: [...s.commonCosts, ...costs] })
        }
      />
      <div className="max-w-48">
        <NumField label="선택 기간 중 휴무일" value={s.closedDays} suffix="일" onChange={(v) => onChange({ closedDays: Math.round(v ?? 0) })} />
      </div>
    </section>
  );
}

export function PriceSimPanel({ result: r, fixed, scope, menus = [] }: { result: ChannelResult; fixed: Q | null; scope: Scope; menus?: MenuTotal[] }) {
  const [delta, setDelta] = useState(1000);
  const [fee, setFee] = useState<number | null>(10);
  // v6: 메뉴 하나만 올리는 실험. 카페처럼 한 주문에 여러 잔이 들어가는 가게는 '주문마다'와 '잔마다'가 다르다.
  const [menuName, setMenuName] = useState("");
  const topMenus = menus.filter((m) => m.qty > 0).slice(0, 12);
  const picked = topMenus.find((m) => m.name === menuName) ?? null;
  const qtyPerOrder = picked && r.N > 0 ? Q.of(picked.qty).div(r.N) : 1;
  const sim = simulatePrice(r, fixed, {
    priceDelta: delta,
    qtyPerOrder,
    feeRatePct: fee ?? 0,
    declinesPct: [0, 5, 10, 15],
  });
  return (
    <section className="card p-4">
      <h2 className="section">가격 실험</h2>
      <p className="mt-1 text-xs muted">
        {picked
          ? `이 기간에 '${picked.name}'이(가) ${picked.qty.toLocaleString("ko-KR")}개 팔렸어요. 그 개수만큼만 올린 값으로 다시 계산해요.`
          : "모든 주문의 판매액을 올렸을 때를 같은 기간 자료로 다시 계산해요."}{" "}
        재료비는 그대로 두고, 주문 감소율은 예측이 아닌 가정이에요.
      </p>
      {topMenus.length > 0 && (
        <label className="mt-3 flex flex-col gap-1 text-sm">
          <span className="muted">무엇을 올릴까요</span>
          <select className="input w-full sm:w-auto sm:max-w-full" value={menuName} onChange={(e) => setMenuName(e.target.value)}>
            <option value="">모든 메뉴 (주문마다)</option>
            {topMenus.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name} — {m.qty.toLocaleString("ko-KR")}개 팔림
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {[300, 500, 1000].map((v) => (
          <button key={v} className={`btn ${delta === v ? "btn-primary" : ""}`} onClick={() => setDelta(v)}>
            +{v.toLocaleString("ko-KR")}원
          </button>
        ))}
        <label className="flex flex-col gap-1 text-sm">
          <span className="muted">직접 입력(원)</span>
          <input
            className="input w-28"
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
          />
        </label>
        <div className="w-40">
          <NumField label="올린 금액에서 중개이용료·결제수수료로 빠지는 몫" value={fee} suffix="%" onChange={setFee} />
          <span className="text-xs muted">플랫폼 중개이용료 + 결제수수료를 어림한 값이에요 (보통 10% 안팎)</span>
        </div>
      </div>
      {sim.status !== "ok" ? (
        <p className="mt-3 text-sm">{sim.reason}</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            주문 1건당 수수료·재료비 뺀 돈 {won(sim.c0)} → <strong>{won(sim.c1)}</strong> ({won(sim.addedPerOrder, { signed: true })})
            {picked && (
              <span className="muted">
                {" "}
                · {picked.name} {picked.qty.toLocaleString("ko-KR")}개 × {delta.toLocaleString("ko-KR")}원을 주문 {count(r.N)}으로 나눈 값
              </span>
            )}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>주문 변화</th>
                  <th>주문 수</th>
                  <th>할인 뺀 매출</th>
                  <th>남는 돈</th>
                  <th>지금보다</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="muted">현재</td>
                  <td>{count(r.N)}</td>
                  <td>{won(r.R)}</td>
                  <td>{won(sim.baseProfit)}</td>
                  <td className="muted">{pct(sim.baseRatio)}</td>
                </tr>
                {sim.scenarios.map((s) => (
                  <tr key={s.declinePct}>
                    <td>{s.declinePct === 0 ? "유지" : picked ? `가게 전체 주문 ${s.declinePct}% 감소` : `${s.declinePct}% 감소`}</td>
                    <td>{count(s.orders)}</td>
                    <td>{won(s.netSales)}</td>
                    <td>{won(s.profit)}</td>
                    <td className={tone(s.diff)}>
                      {won(s.diff, { signed: true })}
                      <div className="text-xs muted">
                        {pct(s.ratio)} (지금은 {pct(sim.baseRatio)})
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm">
            {sim.maxDecline === null
              ? "지금은 주문 1건마다 손해라 계산할 수 없어요."
              : sim.maxDecline.cmp(0) < 0
                ? "이 조건에서는 주문이 늘어야 기존 이익을 유지해요."
                : (
                    <>
                      <strong>{sim.maxDecline.cmp(Q.pct(5)) < 0 ? "빠듯해요." : "괜찮아요."}</strong> 주문이 <strong>{pct(sim.maxDecline)}</strong>까지 줄어도
                      지금만큼 남아요 (최소 {count(sim.minOrders)}).
                      {sim.maxDecline.cmp(Q.pct(5)) < 0 && " 그보다 더 줄면 손해예요."}
                    </>
                  )}
          </p>
          <p className="mt-1 text-xs muted">기준: {SCOPE_LABEL[scope]} · %는 할인 뺀 매출에서 차지하는 비율</p>
        </>
      )}
    </section>
  );
}

export function BreakevenPanel({
  be,
  result: r,
  scope,
  businessDays,
}: {
  be: BreakevenResult;
  result: ChannelResult;
  scope: Scope;
  businessDays: number;
}) {
  const title = scope === "direct" ? "광고비 뽑으려면" : "본전이 되려면 (인건비·월세 포함)";
  return (
    <section className="card p-4">
      <h2 className="section">{title}</h2>
      {be.status === "unavailable" && <p className="mt-2 text-sm">{be.reason}</p>}
      {be.status === "unrecoverable" && (
        <p className="mt-2 text-sm loss">
          주문 1건당 {won(be.perOrderCm)}이라 지금은 주문을 늘려도 광고비·인건비를 메울 수 없어요.
        </p>
      )}
      {be.status === "ok" && (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="muted">주문 1건당 수수료·재료비 뺀 돈</dt>
          <dd className="text-right font-semibold">{won(be.perOrderCm)}</dd>
          <dt className="muted">필요 주문 수</dt>
          <dd className="text-right font-semibold">
            {count(be.orders)} <span className="muted">/ 실제 {count(r.N)}</span>
          </dd>
          <dt className="muted">영업일 {businessDays}일 기준 하루</dt>
          <dd className="text-right font-semibold">{count(be.dailyOrders)}</dd>
          <dt className="muted">필요한 매출 ({count(be.orders)} 기준)</dt>
          <dd className="text-right font-semibold">{won(be.netSalesAtOrders)}</dd>
        </dl>
      )}
      {scope === "direct" && (
        <p className="mt-2 text-xs muted">인건비·월세를 넣지 않은 기준이라 가게 전체의 본전은 아니에요.</p>
      )}
    </section>
  );
}

export function TrendPanel({ store, range }: { store: Store; range: DateRange }) {
  const daily = dailySeries(store, range);
  const monthly = daysInclusive(range) > 62;
  const bars = monthly
    ? monthsBetween(range.start.slice(0, 7), range.end.slice(0, 7)).map((m) => {
        const mr = monthRange(m);
        const partial = mr.start < range.start || mr.end > range.end;
        const days = daily.filter((d) => d.date.startsWith(m));
        return {
          key: m,
          label: `${Number(m.slice(5))}월${partial ? "*" : ""}`,
          net: days.length === 0 ? null : Q.sum(days.map((d) => d.net)), // null = 자료 없는 달
        };
      })
    : daily.map((d) => ({ key: d.date, label: d.date.slice(8), net: d.net as Q | null }));
  const max = bars.reduce((a, b) => (b.net !== null && b.net.cmp(a) > 0 ? b.net : a), Q.ONE);
  return (
    <section className="card p-4">
      <h2 className="section">{monthly ? "달마다" : "날마다"} 할인 뺀 매출</h2>
      {bars.length === 0 ? (
        <p className="mt-2 text-sm">선택 기간에 자료가 없어요.</p>
      ) : (
        <div className="mt-3 flex h-28 items-end gap-[2px]">
          {bars.map((b) => (
            <div key={b.key} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${b.key} ${b.net === null ? "자료 없음" : won(b.net)}`}>
              {b.net === null ? (
                <span className="text-[11px] muted">자료 없음</span>
              ) : (
                <div className="w-full rounded-t" style={{ height: `${b.net.div(max).toNumber() * 88}px`, background: "var(--bar)" }} />
              )}
              {(monthly || bars.length <= 31) && <span className="text-[11px] muted">{monthly ? b.label : b.label.replace(/^0/, "")}</span>}
            </div>
          ))}
        </div>
      )}
      {monthly && <p className="mt-2 text-xs muted">* 일부 날짜만 선택된 달. 자료 없는 날은 0원으로 채우지 않았어요.</p>}
    </section>
  );
}

export function WeekdayPanel({ store, range }: { store: Store; range: DateRange }) {
  const stats = weekdayStats(store, range);
  const have = stats.filter((s) => s.days > 0);
  if (have.length === 0) return null;
  const max = Math.max(1, ...have.map((s) => s.avgAfterDeductions));
  const enough = have.every((s) => s.days >= 3);
  const best = have.reduce((a, b) => (b.avgAfterDeductions > a.avgAfterDeductions ? b : a));
  const worst = have.reduce((a, b) => (b.avgAfterDeductions < a.avgAfterDeductions ? b : a));
  return (
    <section className="card p-4">
      <h2 className="section">
        요일별 하루 평균 <Help>중개이용료·결제수수료·배달비 등을 낸 뒤 금액이에요. 재료비·포장비·광고비는 아직 안 뺀 돈이라 '남는 돈'과는 달라요. 요일끼리 견주는 용도예요.</Help>
      </h2>
      <div className="mt-3 flex flex-col gap-2">
        {stats.map((s) => (
          <div key={s.day} className="flex items-center gap-2 text-sm">
            <span className="w-6 shrink-0 font-semibold">{s.label}</span>
            {s.days === 0 ? (
              <span className="muted">자료 없음</span>
            ) : (
              <>
                <div className="h-3 min-w-0 flex-1 rounded bg-[var(--line)]">
                  <div className="h-3 rounded" style={{ width: `${Math.max(2, (s.avgAfterDeductions / max) * 100)}%`, background: "var(--bar)" }} />
                </div>
                <span className="w-24 shrink-0 text-right num">{wonShort(Q.of(Math.round(s.avgAfterDeductions)))}</span>
                <span className="w-16 shrink-0 text-right muted">{s.avgOrders.toFixed(1)}건</span>
              </>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs muted">
        {enough && best.day !== worst.day ? `${best.label}요일이 가장 많고 ${worst.label}요일이 가장 적어요. ` : ""}
        자료가 있는 날만 평균에 넣었고(요일마다 {have.map((s) => s.days).join("·")}일), 쉰 날·자료 없는 날은 0원으로 채우지 않았어요.{!enough && " 요일마다 3일은 있어야 비교가 되니, 기간을 더 길게 잡아 보세요."}
      </p>
    </section>
  );
}

export function DataCheckNotice({ store, range }: { store: Store; range: DateRange }) {
  const issues = verifyStore(store, range);
  if (issues.length === 0) return null;
  return (
    <section className="card border-[var(--loss)] p-4" role="alert">
      <p className="font-semibold loss">자료 검산에서 이상한 점을 찾았어요</p>
      <ul className="mt-1 list-disc pl-5 text-sm">
        {issues.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
      <p className="mt-1 text-xs muted">이 상태의 숫자는 그대로 믿지 마시고, 자료 가져오기를 다시 해 보세요.</p>
    </section>
  );
}

export function RecommendationPanel({
  result: r,
  fixed,
  hasMenus = false,
  menus = [],
  priceLocked = false,
  onPriceLocked,
}: {
  result: ChannelResult;
  fixed: Q | null;
  hasMenus?: boolean;
  menus?: MenuTotal[];
  priceLocked?: boolean;
  onPriceLocked?: (v: boolean) => void;
}) {
  const items: { title: string; detail: string; impact: Q | null }[] = [];
  // v6: 할인·포장비·옵션 제안은 항상 보여 주고, '본사 가격' 체크는 가격 인상 항목만 뺀다
  //     (검토: 체크해야만 더 큰 제안이 나타나는 건 '숨긴 추천 공개'처럼 보였음)
  {
    if (r.D.isPositive() && r.N > 0) {
      const half = r.D.div(2);
      items.push({
        title: "사장님이 낸 할인 줄이기",
        detail: `이 기간 사장님 돈으로 깎아 준 할인이 ${won(r.D)}이에요 (주문 1건당 ${won(r.D.div(r.N))}). 할인을 절반으로 줄이고 주문이 그대로면 ${won(half, { signed: true })}. 주문이 줄 수 있으니 한 메뉴부터 시험해 보세요.`,
        impact: half,
      });
    }
    if (r.packaging !== null && r.packaging.isPositive() && r.N > 0) {
      const save = Q.of(100).mul(r.N);
      items.push({
        title: "포장 용기 100원 아끼기",
        detail: `주문마다 포장비를 100원만 줄여도 이 기간에 ${won(save, { signed: true })}. 용기 단가·묶음 구매를 한 번 확인해 보세요. 용기가 본사 지정이면 건너뛰세요.`,
        impact: save,
      });
    }
    const opts = menus
      .flatMap((m) => m.options.map((o) => ({ menu: m.name, ...o })))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 2);
    if (opts.length)
      items.push({
        title: "잘 나가는 옵션을 세트로",
        detail: `옵션 매출이 큰 것: ${opts.map((o) => `${o.menu}의 '${o.name}' ${won(o.sales)}`).join(", ")}. 세트·추가 옵션 구성은 가게에서 정할 수 있어요.`,
        impact: null,
      });
  }
  const sim = simulatePrice(r, fixed, { priceDelta: 500, qtyPerOrder: 1, feeRatePct: 10, declinesPct: [0, 5] });
  // v6: 가장 많이 팔린 메뉴 하나만 올릴 때 — 이 메뉴가 팔린 개수만큼만 계산
  const top = menus.filter((m) => m.qty > 0)[0];
  const topSim =
    top && r.N > 0 ? simulatePrice(r, fixed, { priceDelta: 500, qtyPerOrder: Q.of(top.qty).div(r.N), feeRatePct: 10, declinesPct: [0, 5] }) : null;
  if (!priceLocked && topSim && topSim.status === "ok") {
    items.push({
      title: `'${top.name}'만 500원 올리면`,
      detail: `이 기간에 ${top.qty.toLocaleString("ko-KR")}개 팔린 메뉴예요. 주문이 그대로면 ${won(topSim.scenarios[0].diff, { signed: true })} (${top.qty.toLocaleString("ko-KR")}개 × 450원). 이 메뉴 주문이 줄면 그만큼 효과가 작아져요. 올린 금액의 10%는 중개이용료·결제수수료로 빠진다고 봤어요.`,
      impact: topSim.scenarios[0].diff,
    });
  }
  if (!priceLocked && sim.status === "ok") {
    // v4: 계산은 '모든 주문 +500원'인데 제목이 '대표 메뉴'라 효과가 과장돼 보였음 → 계산 그대로 적는다
    // 검토: 주문이 5%만 줄어도 손해면 첫 추천으로 올리지 않는다 (정렬은 둘 중 작은 값으로, '신중' 표시)
    const risky = sim.scenarios[1].diff.cmp(0) < 0;
    items.push({
      title: risky ? "주문마다 500원씩 더 받으면 (신중)" : "주문마다 500원씩 더 받으면",
      detail: `모든 주문의 결제 금액이 500원씩 오른다고 볼 때, 주문이 그대로면 ${won(sim.scenarios[0].diff, { signed: true })}, 주문이 5% 줄면 ${won(sim.scenarios[1].diff, { signed: true })}.${risky ? " 주문이 조금만 줄어도 손해라 신중하게 보세요." : ""} 올린 금액의 10%는 중개이용료·결제수수료로 빠진다고 보고 계산했어요. 메뉴 하나만 올릴 때 효과는 이보다 작아요.`,
      impact: risky ? sim.scenarios[1].diff : sim.scenarios[0].diff,
    });
  }
  if (r.flags.packagingMissing)
    items.push({ title: "포장비 입력", detail: "포장비가 빠진 추정이라 실제 남는 금액은 더 적어요.", impact: null });
  if (r.flags.hasUnclassified)
    items.push({ title: "확인이 필요한 정산 항목", detail: `${won(r.deductionsByKind.unclassified)}이 무슨 돈인지 배민 정산명세서에서 확인해 주세요.`, impact: null });
  // 남는 돈이 많이 커지는 것부터, 금액을 모르는 제안은 뒤로
  items.sort((a, b) => (b.impact ? b.impact.toNumber() : -Infinity) - (a.impact ? a.impact.toNumber() : -Infinity));

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section">개선 추천</h2>
        {onPriceLocked && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={priceLocked} onChange={(e) => onPriceLocked(e.target.checked)} />
            가격을 제가 정할 수 없어요 (본사 가격)
          </label>
        )}
      </div>
      <p className="mt-1 text-xs muted">
        사장님 자료를 정해진 계산식에 넣어 만든 제안이에요. 남는 돈이 많이 커지는 것부터 보여 줘요.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((it) => (
          <li key={it.title} className="rounded-lg p-3 text-sm" style={{ background: "var(--soft)" }}>
            <div className="flex items-center gap-2 font-semibold">
              {it.title}
            </div>
            <div className="mt-1">{it.detail}</div>
          </li>
        ))}
        {!hasMenus && (
          <li className="rounded-lg p-3 text-sm muted" style={{ background: "var(--soft)" }}>
            메뉴·옵션·세트 점검(가격 역전, 필수 유료 옵션, 저마진 조합)은 메뉴 자료를 가져온 뒤에 보여 줘요. 예시 가게에는 메뉴 자료가 없어요.
          </li>
        )}
        {hasMenus && (
          <li className="rounded-lg p-3 text-sm muted" style={{ background: "var(--soft)" }}>
            어떤 메뉴가 남고 어떤 메뉴가 손해인지는 &lsquo;자세히 보기&rsquo;의 &lsquo;메뉴별&rsquo;에서 볼 수 있어요.
          </li>
        )}
      </ul>
    </section>
  );
}

/**
 * 메뉴별 수익성. 메뉴 판매액에는 그 메뉴에 붙은 유료 옵션이 포함된다.
 * 수수료(중개·결제)는 판매액에 비례하므로 실제 비율로 나눠 붙이고,
 * 배달비·포장비처럼 주문 단위로 붙는 비용은 메뉴에 나누지 않는다 (나누면 근거 없는 숫자가 된다).
 */
export function MenuPanel({
  menus,
  result: r,
  settings: s,
  onChange,
}: {
  menus: MenuTotal[];
  result: ChannelResult;
  settings: CostSettings;
  onChange: (p: Partial<CostSettings>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [wizard, setWizard] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]); // 순서대로 넣기에서 건너뛴 메뉴

  if (!menus.length)
    return (
      <section className="card p-4">
        <h2 className="section">메뉴별 수익성</h2>
        <p className="mt-2 text-sm">이 기간에 수집된 메뉴 자료가 없어요.</p>
      </section>
    );

  const totalSales = Q.sum(menus.map((m) => m.sales));
  // 판매액에 비례하는 비용(중개·결제·공제 부가세)의 실제 비율
  const feeRate = r.G.isZero()
    ? Q.ZERO
    : r.deductionsByKind.brokerage.add(r.deductionsByKind.payment).add(r.deductionsByKind.other).div(r.G);
  const rate = s.cogs.ratePct === null ? null : Q.pct(s.cogs.ratePct);

  const rows = menus.map((m) => {
    const sales = Q.of(m.sales);
    const unitCost = s.menuCosts?.[m.name];
    const cost = unitCost !== undefined ? Q.of(unitCost).mul(m.qty) : rate === null ? null : sales.mul(rate);
    const fee = sales.mul(feeRate);
    const margin = cost === null ? null : sales.sub(cost).sub(fee);
    return { m, sales, cost, fee, margin, unitCost, estimated: unitCost === undefined };
  });
  const shown = open ? rows : rows.slice(0, 8);
  const marginTotal = rows.every((x) => x.margin !== null) ? Q.sum(rows.map((x) => x.margin!)) : null;

  function saveCost(name: string, value: string) {
    const next = { ...(s.menuCosts ?? {}) };
    if (value.trim() === "") delete next[name];
    else next[name] = Math.round(Number(value.replace(/[^\d.]/g, "")) || 0);
    onChange({ menuCosts: next });
    setEditing(null);
  }

  // 많이 팔리는 메뉴부터 한 개씩 원가를 물어본다 (표에서 칸마다 누르는 것보다 쉽다)
  const todo = rows.filter((x) => x.unitCost === undefined && !skipped.includes(x.m.name));
  const current = wizard ? todo[0] : null;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section">메뉴별 수익성</h2>
        <div className="flex items-center gap-2">
          <span className="chip">{menus.length}개 메뉴</span>
          {todo.length > 0 && (
            <button className="btn" onClick={() => setWizard((v) => !v)}>
              {wizard ? "그만하기" : "원가 순서대로 넣기"}
            </button>
          )}
        </div>
      </div>

      {current && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <div className="text-xs">
            남은 메뉴 {todo.length}개 · 많이 팔리는 순서예요. 모르면 <strong>건너뛰기</strong>를 누르세요 (원가율로 계산됩니다).
          </div>
          <div className="mt-2 font-semibold">{current.m.name}</div>
          <div className="mt-1 text-xs">
            {count(current.m.qty, "개")} 팔림 · 판매액 {won(current.sales)} · 개당 {won(current.sales.div(Math.max(1, current.m.qty)))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-sm">이 메뉴 1개 만드는 재료비</span>
            <input
              className="input w-28"
              inputMode="numeric"
              autoFocus
              placeholder="예: 4500"
              value={text}
              onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && text !== "") {
                  saveCost(current.m.name, text);
                  setText("");
                }
              }}
            />
            <span className="text-sm">원</span>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (text === "") return;
                saveCost(current.m.name, text);
                setText("");
              }}
            >
              넣고 다음
            </button>
            <button
              className="btn"
              onClick={() => {
                setSkipped((v) => [...v, current.m.name]);
                setText("");
              }}
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}
      <p className="mt-1 text-xs muted">
        판매액에는 그 메뉴에 붙은 유료 옵션이 들어 있어요. 배달비·포장비처럼 주문 1건에 붙는 비용은 메뉴별로 나누지 않았어요.
        원가를 넣은 메뉴는 그 값으로, 나머지는 원가율로 계산해요.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>메뉴</th>
              <th>수량</th>
              <th>판매액</th>
              <th>비중</th>
              <th>개당 원가</th>
              <th>남는 돈</th>
              <th>남는 비율</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ m, sales, cost, margin, unitCost, estimated }) => (
              <tr key={m.name}>
                <td className="max-w-[16rem] truncate" title={m.name}>
                  {m.name}
                  <div className="text-xs muted">개당 {won(sales.div(Math.max(1, m.qty)))}</div>
                </td>
                <td>{count(m.qty, "개")}</td>
                <td>{won(sales)}</td>
                <td>{pct(totalSales.isZero() ? null : sales.div(totalSales))}</td>
                <td>
                  {editing === m.name ? (
                    <input
                      className="input w-24 py-1 text-right"
                      autoFocus
                      inputMode="numeric"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onBlur={() => saveCost(m.name, text)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveCost(m.name, text);
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                  ) : (
                    <button
                      className="tap-target underline decoration-dotted"
                      onClick={() => {
                        setEditing(m.name);
                        setText(unitCost === undefined ? "" : String(unitCost));
                      }}
                    >
                      {unitCost === undefined ? <span className="muted">입력</span> : won(unitCost)}
                    </button>
                  )}
                </td>
                <td className={tone(margin)}>
                  {won(margin)}
                  {estimated && cost !== null && <div className="text-xs muted">원가율로 어림</div>}
                </td>
                <td>{pct(margin === null || sales.isZero() ? null : margin.div(sales))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 8 && (
        <button className="btn mt-3" onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : `나머지 ${rows.length - 8}개 더 보기`}
        </button>
      )}
      <p className="mt-3 text-sm">
        메뉴에서 남는 돈 합계 <strong>{won(marginTotal)}</strong>
        <span className="muted"> · 여기서 배달비·포장비·광고비·인건비·월세를 빼면 실제로 남는 금액이 돼요.</span>
      </p>
      {shown.some((x) => x.estimated) && (
        <p className="mt-1 text-xs muted">
          개당 원가를 넣으면 그 메뉴는 추정 대신 실제 값으로 계산하고, 전체 손익에도 바로 반영돼요.
        </p>
      )}
    </section>
  );
}

/**
 * 우리가게클릭(CPC) 광고 효율. 광고비·광고 연결 주문은 배민 가게통계에서 가져온 월 단위 자료다.
 * 주문 1건이 남기는 돈(공헌이익)으로 '클릭당 얼마까지 내도 남는지'를 계산한다.
 */
export function AdEfficiencyPanel({
  result: r,
  marketing,
}: {
  result: ChannelResult;
  marketing: Record<string, { orderCount: number; orderAmount: number; groups: Record<string, { cost: number | null; orderCount: number; orderAmount: number }> }>;
}) {
  const months = Object.keys(marketing).sort();
  const [month, setMonth] = useState(months[months.length - 1] ?? "");
  const m = marketing[month];
  const cpc = m?.groups?.CPC;
  const perOrderCm = r.cm !== null && r.N > 0 ? r.cm.div(r.N) : null;

  if (!cpc || !cpc.cost)
    return (
      <section className="card p-4">
        <h2 className="section">광고 효율</h2>
        <p className="mt-2 text-sm">이 기간의 우리가게클릭 광고비 자료가 없어요.</p>
      </section>
    );

  const cost = Q.of(cpc.cost);
  const adOrders = Q.of(cpc.orderCount || 0);
  const costPerAdOrder = cpc.orderCount ? cost.div(adOrders) : null;
  const costPerAllOrder = m.orderCount ? cost.div(m.orderCount) : null;
  const roas = cpc.orderAmount ? Q.of(cpc.orderAmount).div(cost) : null;
  const shareOfSales = cpc.orderAmount ? cost.div(cpc.orderAmount) : null; // 광고로 들어온 매출 대비
  const cmFromAds = perOrderCm && cpc.orderCount ? perOrderCm.mul(cpc.orderCount) : null;
  const costShareOfCm = cmFromAds && !cmFromAds.isZero() ? cost.div(cmFromAds) : null;

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="section">광고 효율 (우리가게클릭)</h2>
        <select className="input w-auto py-1" value={month} onChange={(e) => setMonth(e.target.value)}>
          {months.map((k) => (
            <option key={k} value={k}>
              {Number(k.slice(5))}월
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-xs muted">배민 가게통계에서 가져온 광고비예요. 주문별 정산에는 없는 비용이라 따로 반영했어요.</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt className="muted">광고비</dt>
        <dd className="text-right font-semibold">{won(cost)}</dd>
        <dt className="muted">광고 연결 주문</dt>
        <dd className="text-right font-semibold">
          {count(cpc.orderCount)} <span className="muted">/ 전체 {count(m.orderCount)}</span>
        </dd>
        <dt className="muted">광고 주문 1건당 광고비</dt>
        <dd className="text-right font-semibold">{won(costPerAdOrder)}</dd>
        <dt className="muted">전체 주문 1건당</dt>
        <dd className="text-right font-semibold">{won(costPerAllOrder)}</dd>
        <dt className="muted">광고로 들어온 매출 중 광고비</dt>
        <dd className="text-right font-semibold">{pct(shareOfSales)}</dd>
        <dt className="muted">광고비 1만원에 들어온 매출</dt>
        <dd className="text-right font-semibold">{roas === null ? "계산 불가" : `${(Math.round(roas.toNumber() * 10) / 10).toLocaleString("ko-KR")}만원`}</dd>
      </dl>
      {perOrderCm === null ? (
        <p className="mt-3 text-sm">재료원가를 입력하면 &lsquo;클릭당 얼마까지 내도 남는지&rsquo;를 계산해 드려요.</p>
      ) : (
        <>
          <p className="mt-3 text-sm">
            광고 주문이 남긴 이익 <strong>{won(cmFromAds)}</strong> 중 광고비가 <strong>{pct(costShareOfCm)}</strong>예요.
          </p>
          <p className="mt-1 text-xs muted">
            주문 1건당 남는 돈 {won(perOrderCm)} 기준이며, 광고 주문이 없었으면 안 왔을 주문이라고 가정한 값이에요. 원래 올 손님이 광고를 누른
            경우도 있어 실제 효과는 더 작을 수 있어요.
          </p>
        </>
      )}
    </section>
  );
}

/**
 * 월별 비교. 각 달을 같은 원가·비용 기준으로 따로 계산한다.
 * 기간 전체 이익률은 합계에서 계산하고, 월별 비율의 평균을 쓰지 않는다 (CALC 07).
 */
export function MonthlyPanel({
  store,
  settings,
  range,
  scope,
}: {
  store: Store;
  settings: CostSettings;
  range: DateRange;
  scope: Scope;
}) {
  const months = monthsBetween(range.start.slice(0, 7), range.end.slice(0, 7));
  if (months.length < 2) return null;

  const rows = months.map((m) => {
    const mr = monthRange(m);
    const sub = { start: mr.start < range.start ? range.start : mr.start, end: mr.end > range.end ? range.end : mr.end };
    const agg = aggregateFn(store, settings, sub);
    const r = computeChannel(agg.input);
    const head = headlineFn(r, scope);
    const partial = sub.start !== mr.start || sub.end !== mr.end;
    return { m, sub, partial, r, head, days: agg.coverage.coveredDays };
  });

  return (
    <section className="card p-4">
      <h2 className="section">월별 비교</h2>
      <p className="mt-1 text-xs muted">
        같은 원가·비용 기준으로 달마다 따로 계산했어요. * 는 일부 날짜만 선택된 달이라 그대로 비교하면 안 돼요.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>월</th>
              <th>자료 일수</th>
              <th>주문</th>
              <th>할인 뺀 매출</th>
              <th>주문당 남는 금액</th>
              <th>기간 이익</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, partial, r, head, days }) =>
              days === 0 ? (
                // v4: 자료가 없는 달을 0건·0원으로 보여 주면 '매출 0원'으로 읽혀서 따로 표시
                <tr key={m}>
                  <td>{Number(m.slice(5))}월</td>
                  <td className="muted" colSpan={5}>
                    자료 없음 — 이 달은 아직 가져오지 않았어요
                  </td>
                </tr>
              ) : (
                <tr key={m}>
                  <td>
                    {Number(m.slice(5))}월{partial ? "*" : ""}
                  </td>
                  <td className="muted">{days}일</td>
                  <td>{count(r.N)}</td>
                  <td>{won(r.R)}</td>
                  <td className={tone(head.perOrder)}>{won(head.perOrder)}</td>
                  <td className={tone(head.period)}>
                    {won(head.period)}
                    <div className="text-xs muted">{pct(head.ratio)}</div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 정산 대조: 실제로 통장에 들어온(들어올) 금액. 주문 손익과 기준일이 다르다는 걸 분명히 보여 준다. */
export function SettlementPanel({
  settlements,
  range,
}: {
  settlements: NonNullable<StoreDataFile["settlements"]>;
  range: DateRange;
}) {
  const [open, setOpen] = useState(false);
  // 같은 정산(giveId)이 겹쳐 들어오면 뒤의 것 하나만 쓰고, 입금일이 최근인 순서로 보여 준다
  settlements = [...new Map(settlements.map((s) => [s.giveId, s])).values()].sort((a, b) => (a.depositDueDate < b.depositDueDate ? 1 : a.depositDueDate > b.depositDueDate ? -1 : 0));
  // 입금일 기준으로 선택 기간과 겹치는 정산 건
  const inRangeList = settlements.filter((s) => s.depositDueDate >= range.start && s.depositDueDate <= range.end);
  const list = inRangeList.length ? inRangeList : settlements;
  const deposit = Q.sum(list.map((s) => s.depositAmount));
  const ads = Q.sum(list.map((s) => s.adCost));
  const adj = Q.sum(list.map((s) => s.adjustment));
  // v8: 입금완료가 아닌 정산(입금 전)은 빨갛게 — 통장에 아직 안 들어온 돈을 놓치지 않게
  const pending = list.filter((s) => s.status !== "입금완료");
  const pendingSum = Q.sum(pending.map((s) => s.depositAmount));
  const shown = open ? list : list.slice(0, 6);
  // 입금 내역 기준 최근 30일 — 통장에 찍힌 돈과 바로 맞춰 볼 수 있는 합계
  const basis = depositBasis(settlements, koreaToday());
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

  return (
    <section className="card p-4">
      <h2 className="section">정산 대조</h2>
      {basis.count > 0 && (
        <div className="mt-3 rounded-lg p-3" style={{ background: "var(--soft)" }}>
          <div className="text-sm font-semibold">
            입금 내역 기준 최근 30일 ({md(basis.start)}~{md(basis.end)}){" "}
            <Help>통장에 들어온(들어올) 날짜가 최근 30일인 정산만 더한 값이에요. 통장 내역과 바로 맞춰 볼 수 있어요. 배민 정산이 아직 안 끝난 최근 주문은 들어 있지 않아요.</Help>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
            <dt className="muted">입금 {basis.count}건 합계</dt>
            <dd className="text-right text-lg font-extrabold">{won(basis.deposit)}</dd>
            <dt className="muted">하루 평균</dt>
            <dd className="text-right font-semibold">{won(basis.perDay)}</dd>
            <dt className="muted">그중 광고비로 빠진 돈</dt>
            <dd className="text-right font-semibold">{won(basis.ads)}</dd>
            {basis.pendingCount > 0 && (
              <>
                <dt className="loss font-semibold">아직 입금 전</dt>
                <dd className="loss text-right font-semibold">
                  {basis.pendingCount}건 · {won(basis.pendingSum)}
                </dd>
              </>
            )}
            {basis.upcomingCount > 0 && (
              <>
                <dt className="muted">앞으로 입금 예정</dt>
                <dd className="text-right font-semibold">
                  {basis.upcomingCount}건 · {won(basis.upcomingSum)}
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
      <p className="mt-3 text-sm font-semibold">선택한 기간 기준</p>
      <p className="mt-1 text-xs muted">
        {inRangeList.length ? "선택 기간에 입금된(입금 예정인) 정산이에요." : "선택 기간에 입금 건이 없어 수집한 전체를 보여 줘요."} 주문 손익은
        주문일 기준, 입금은 정산일 기준이라 기간이 서로 달라요.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <dt className="muted">입금액 합계</dt>
        <dd className="text-right font-semibold">{won(deposit)}</dd>
        <dt className="muted">그중 광고비로 빠진 돈</dt>
        <dd className="text-right font-semibold">{won(ads)}</dd>
        {!adj.isZero() && (
          <>
            <dt className="muted">조정·지원금</dt>
            <dd className="text-right font-semibold">{won(adj)}</dd>
          </>
        )}
        {pending.length > 0 && (
          <>
            <dt className="loss font-semibold">아직 입금 전</dt>
            <dd className="loss text-right font-semibold">
              {pending.length}건 · {won(pendingSum)}
            </dd>
          </>
        )}
      </dl>
      <div className="mt-3 overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>입금일</th>
              <th>정산 기간</th>
              <th>상태</th>
              <th>입금액</th>
              <th>광고비</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.giveId}>
                <td>{s.depositDueDate.slice(5)}</td>
                <td className="muted">{s.settlePeriod.start === s.settlePeriod.end ? s.settlePeriod.start.slice(5) : `${s.settlePeriod.start.slice(5)}~${s.settlePeriod.end.slice(5)}`}</td>
                <td className={s.status === "입금완료" ? "" : "loss font-semibold"}>{s.status === "입금완료" ? s.status : `${s.status} · 아직 입금 전`}</td>
                <td>{won(s.depositAmount)}</td>
                <td>{s.adCost ? won(s.adCost) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pending.length > 0 && (
        <p className="mt-2 text-sm loss">빨간 줄은 아직 통장에 들어오지 않은 정산이에요. 입금일이 지나도 계속 빨갛다면 배민에 확인해 보세요.</p>
      )}
      {list.length > 6 && (
        <button className="btn mt-3" onClick={() => setOpen((v) => !v)}>
          {open ? "접기" : `나머지 ${list.length - 6}건 더 보기`}
        </button>
      )}
    </section>
  );
}

interface ActionEntry {
  date: string;
  text: string;
}

export function ActionLog({ businessId }: { businessId: string }) {
  const key = `bpn-actions-${businessId}`;
  const [entries, setEntries] = useState<ActionEntry[]>([]);
  const [date, setDate] = useState(() => koreaToday());
  const [text, setText] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setEntries(raw ? (JSON.parse(raw) as ActionEntry[]) : []);
    } catch {
      setEntries([]);
    }
  }, [key]);

  function save(next: ActionEntry[]) {
    setEntries(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* 저장 불가 환경에서는 화면에만 유지 */
    }
  }

  return (
    <section className="card p-4">
      <h2 className="section">실행 기록</h2>
      <p className="mt-1 text-xs muted">
        배민에서 직접 바꾼 내용과 적용일을 남겨요. 변경 전후 비교는 자료가 쌓인 뒤 추가할 예정이에요. (이 브라우저에만 저장)
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input type="date" className="input w-auto" value={date} onChange={(e) => setDate(e.target.value)} />
        <input
          className="input min-w-0 flex-1"
          placeholder="예: 국밥 전 메뉴 +500원"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn btn-primary"
          onClick={() => {
            if (!text.trim()) return;
            save([{ date, text: text.trim() }, ...entries]);
            setText("");
          }}
        >
          기록
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-1 text-sm">
        {entries.length === 0 && <li className="muted">아직 기록이 없어요.</li>}
        {entries.map((e, i) => (
          <li key={`${e.date}-${i}`} className="flex justify-between gap-2">
            <span>
              <span className="muted">{e.date}</span> {e.text}
            </span>
            <button className="tap-target underline muted" onClick={() => save(entries.filter((_, j) => j !== i))}>
              삭제
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
