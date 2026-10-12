// 손익분기점과 목표 이익 (PRD CALC 06)
import { Q } from "./rational";
import type { ChannelResult } from "./profit";

export type BreakevenResult =
  | { status: "unavailable"; reason: string }
  | { status: "unrecoverable"; perOrderCm: Q }
  | {
      status: "ok";
      perOrderCm: Q;
      orders: bigint;
      netSales: Q; // 이론적 손익분기 순매출
      netSalesAtOrders: Q; // 정수 주문 수 기준 순매출
      dailyOrders: bigint | null;
      targetOrders: bigint | null;
      targetDailyOrders: bigint | null;
    };

export function breakeven(
  r: ChannelResult,
  fixed: Q | null,
  opts: { businessDays: number; target?: number | null },
): BreakevenResult {
  if (r.cm === null) return { status: "unavailable", reason: "재료원가를 입력하면 계산할 수 있어요." };
  if (fixed === null) return { status: "unavailable", reason: "고정비(광고·공통비) 입력이 필요해요." };
  if (r.N <= 0) return { status: "unavailable", reason: "완료 주문이 없어 계산할 수 없어요." };

  const c = r.cm.div(r.N);
  if (c.cmp(0) <= 0 || r.R.cmp(0) <= 0) return { status: "unrecoverable", perOrderCm: c };

  const orders = fixed.div(c).ceil();
  const days = opts.businessDays > 0 ? opts.businessDays : null;
  const ceilDiv = (a: bigint) => (days ? Q.frac(a, days).ceil() : null);
  const targetOrders = opts.target != null ? fixed.add(opts.target).div(c).ceil() : null;

  return {
    status: "ok",
    perOrderCm: c,
    orders,
    netSales: fixed.div(r.cm.div(r.R)),
    netSalesAtOrders: r.R.div(r.N).mul(orders),
    dailyOrders: ceilDiv(orders),
    targetOrders,
    targetDailyOrders: targetOrders === null ? null : ceilDiv(targetOrders),
  };
}
