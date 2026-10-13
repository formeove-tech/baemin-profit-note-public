// v9: 사장님이 한눈에 읽는 한 줄짜리 숫자들. 계산은 엔진 결과를 그대로 쓰고 새 가정을 넣지 않는다.
import { Q } from "./engine/rational";
import { addDays } from "./engine/period";
import { type ChannelResult, computeChannel, DEDUCTION_LABEL, type DeductionKind, headline, type Scope } from "./engine/profit";
import { aggregate, type CostSettings, type Store } from "./dataset";

/** 평균 주문(객단가) 1건당 항목별 금액(parts)과 공제 합계 ÷ 주문 수 */
export function takeShare(r: ChannelResult): {
  per100: Q;
  perOrder: Q | null;
  withAd: Q | null;
  /** 주문 1건 평균 객단가(할인 뺀 매출 ÷ 주문 수) */
  avgTicket: Q | null;
  /** 광고비·구독료까지 넣은 주문 1건당 비용 */
  perOrderWithAd: Q | null;
  /** 항목별(중개이용료·결제수수료·배달비 등) 1건당 금액. 0원 항목은 뺀다 */
  parts: { kind: DeductionKind; label: string; perOrder: Q | null; per100: Q }[];
} | null {
  if (r.R.cmp(0) <= 0) return null;
  const per100 = r.deductionTotal.mul(100).div(r.R);
  const perOrder = r.N > 0 ? r.deductionTotal.div(r.N) : null;
  const avgTicket = r.N > 0 ? r.R.div(r.N) : null;
  // 광고비·구독료 같은 배민 전용 기간 비용까지 넣은 값 (입력돼 있을 때만)
  const withAd = r.directFixed === null ? null : r.deductionTotal.add(r.directFixed).mul(100).div(r.R);
  const perOrderWithAd = r.directFixed === null || r.N <= 0 ? null : r.deductionTotal.add(r.directFixed).div(r.N);
  const parts = (Object.keys(r.deductionsByKind) as DeductionKind[])
    .filter((k) => !r.deductionsByKind[k].isZero())
    .map((k) => ({
      kind: k,
      label: DEDUCTION_LABEL[k],
      perOrder: r.N > 0 ? r.deductionsByKind[k].div(r.N) : null,
      per100: r.deductionsByKind[k].mul(100).div(r.R),
    }));
  return { per100, perOrder, withAd, avgTicket, perOrderWithAd, parts };
}

export interface WeekWindow {
  start: string;
  end: string;
  days: number;
  value: Q | null;
}

/**
 * 자료가 있는 마지막 날을 끝으로, 최근 7일과 그 전 7일의 '남는 돈'을 같은 설정으로 계산한다.
 * 어느 쪽이든 자료가 있는 날이 5일 미만이면 견주지 않는다(null).
 */
export function weeklyCompare(store: Store, settings: CostSettings, scope: Scope): { cur: WeekWindow; prev: WeekWindow; diff: Q } | null {
  if (store.rows.length === 0) return null;
  const last = store.rows.reduce((a, r) => (r.date > a ? r.date : a), "");
  const win = (end: string): WeekWindow => {
    const range = { start: addDays(end, -6), end };
    const agg = aggregate(store, settings, range);
    const value = headline(computeChannel(agg.input), scope).period;
    return { start: range.start, end, days: agg.rowCount, value };
  };
  const cur = win(last);
  const prev = win(addDays(last, -7));
  if (cur.days < 5 || prev.days < 5 || cur.value === null || prev.value === null) return null;
  return { cur, prev, diff: cur.value.sub(prev.value) };
}

/** 사장님이 외우고 있는 숫자 3개로 하는 빠른 계산. 입력이 이상하면 null. */
export function quickCalc(input: { sales: number; orders: number; takenByBaemin: number }) {
  const { sales, orders, takenByBaemin } = input;
  if (![sales, orders, takenByBaemin].every((x) => Number.isFinite(x)) || sales <= 0 || orders <= 0 || takenByBaemin < 0 || takenByBaemin > sales * 2) return null;
  return {
    avgOrder: Q.of(Math.round(sales)).div(orders),
    per100: Q.of(Math.round(takenByBaemin)).mul(100).div(Math.round(sales)),
    takenPerOrder: Q.of(Math.round(takenByBaemin)).div(orders),
    /** 재료비·포장비·인건비를 빼기 전 */
    leftBeforeCosts: Q.of(Math.round(sales) - Math.round(takenByBaemin)),
  };
}

export interface DepositInput {
  depositDueDate: string;
  status: string;
  depositAmount: number;
  adCost: number;
  adjustment: number;
}

/**
 * 입금 내역 기준 최근 N일(기본 30일): 입금일이 [오늘-(N-1)일, 오늘]인 정산을 더한다.
 * 통장에 찍힌 돈과 바로 맞춰 볼 수 있다. 오늘 이후 입금 예정은 따로 센다. 정산 전 주문은 들어 있지 않다.
 */
export function depositBasis(list: DepositInput[], today: string, days = 30) {
  const start = addDays(today, -(days - 1));
  const inWin = list.filter((s) => s.depositDueDate >= start && s.depositDueDate <= today);
  const upcoming = list.filter((s) => s.depositDueDate > today);
  const sum = (xs: DepositInput[], f: (s: DepositInput) => number) => Q.sum(xs.map((s) => Q.of(f(s))));
  const pending = inWin.filter((s) => s.status !== "입금완료");
  return {
    start,
    end: today,
    days,
    count: inWin.length,
    deposit: sum(inWin, (s) => s.depositAmount),
    perDay: sum(inWin, (s) => s.depositAmount).div(days),
    ads: sum(inWin, (s) => s.adCost),
    adjustment: sum(inWin, (s) => s.adjustment),
    pendingCount: pending.length,
    pendingSum: sum(pending, (s) => s.depositAmount),
    upcomingCount: upcoming.length,
    upcomingSum: sum(upcoming, (s) => s.depositAmount),
  };
}
