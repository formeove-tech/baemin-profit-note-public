// 가격 변경 시뮬레이션 (PRD SIM 01~02). 같은 기준 기간·주문 집합에서 가격과 가정만 바꾼다.
import { Q, type QLike } from "./rational";
import type { ChannelResult } from "./profit";

export interface PriceInput {
  /** 메뉴 1개당 인상액(원) */
  priceDelta: number;
  /** 주문 1건에 들어 있는 해당 메뉴 평균 수량 (전체 메뉴 인상이면 1, 메뉴 하나면 그 메뉴 판매량 ÷ 주문 수) */
  qtyPerOrder: QLike;
  /** 인상분에 붙는 중개·결제 비용 비율(%) — 사용자 가정 */
  feeRatePct: number;
  /** 주문 감소 가정(%) */
  declinesPct: number[];
}

export interface PriceScenario {
  declinePct: number;
  orders: bigint;
  netSales: Q;
  profit: Q;
  diff: Q;
  ratio: Q | null;
}

export type PriceSimResult =
  | { status: "unavailable"; reason: string }
  | {
      status: "ok";
      c0: Q; // 기준 주문당 공헌이익
      c1: Q; // 변경 후 주문당 공헌이익
      addedPerOrder: Q;
      baseProfit: Q;
      baseRatio: Q | null;
      scenarios: PriceScenario[];
      /** 기존 이익을 유지하는 주문 감소 한계 (음수면 주문이 늘어야 함), c0·c1 > 0 일 때만 */
      maxDecline: Q | null;
      /** 기존 이익 유지 최소 주문 수 */
      minOrders: bigint | null;
    };

export function simulatePrice(r: ChannelResult, fixed: Q | null, p: PriceInput): PriceSimResult {
  if (r.cm === null) return { status: "unavailable", reason: "재료원가를 입력하면 계산할 수 있어요." };
  if (fixed === null) return { status: "unavailable", reason: "고정비(광고·공통비) 입력이 필요해요." };
  if (r.N <= 0) return { status: "unavailable", reason: "완료 주문이 없어 계산할 수 없어요." };

  const N = Q.of(r.N);
  const c0 = r.cm.div(N);
  // 재료원가 금액은 그대로 둔다 (가격만 올렸다고 같은 음식의 원가가 오르지 않음, AC 13)
  const delta = Q.of(p.priceDelta).mul(p.qtyPerOrder);
  const addedPerOrder = delta.sub(delta.mul(Q.pct(p.feeRatePct)));
  const c1 = c0.add(addedPerOrder);
  const netPerOrder1 = r.R.div(N).add(delta);

  const baseProfit = r.cm.sub(fixed);
  const scenarios = p.declinesPct.map((d) => {
    const orders = N.mul(Q.ONE.sub(Q.pct(d))).round();
    const profit = c1.mul(orders).sub(fixed);
    const netSales = netPerOrder1.mul(orders);
    return {
      declinePct: d,
      orders,
      netSales,
      profit,
      diff: profit.sub(baseProfit),
      ratio: netSales.isZero() ? null : profit.div(netSales),
    };
  });

  const positive = c0.isPositive() && c1.isPositive();
  return {
    status: "ok",
    c0,
    c1,
    addedPerOrder,
    baseProfit,
    baseRatio: r.R.isZero() ? null : baseProfit.div(r.R),
    scenarios,
    maxDecline: positive ? Q.ONE.sub(c0.div(c1)) : null,
    minOrders: c1.isPositive() ? baseProfit.add(fixed).div(c1).ceil() : null,
  };
}
