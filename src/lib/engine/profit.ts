// 배민 채널 손익 (PRD CALC 02~05). 입력이 없는 비용은 0원으로 두지 않고 null 로 전달한다.
import { Q, safeDiv } from "./rational";

export type DeductionKind = "brokerage" | "payment" | "delivery" | "other" | "unclassified";

export const DEDUCTION_LABEL: Record<DeductionKind, string> = {
  brokerage: "플랫폼 중개이용료",
  payment: "결제수수료",
  delivery: "배달비",
  other: "부가세 등 기타",
  unclassified: "확인이 필요한 정산 항목",
};

export interface CogsInput {
  /** 전체 재료원가율(%) — null 이면 미입력 */
  ratePct: number | null;
  /** 원가율의 분모: 할인 전 판매액(G) 또는 할인 후 순매출(R) */
  base: "gross" | "net";
  /** 원가율에 포장비가 이미 들어 있는가 */
  includesPackaging: boolean;
  /** 메뉴별 직접 원가(선택). sales 는 해당 메뉴의 할인 전 판매액 합계 */
  detailed?: { menu: string; sales: number; cost: number }[];
}

export interface ChannelInput {
  orders: number; // N: 완료 주문 수
  grossSales: number; // G: 점주 할인 전 상품 판매액
  ownerDiscount: number; // D: 점주 부담 할인
  /** 음식대금과 별개로 매장에 귀속되는 수입 (가게배달팁 등). 객단가에는 넣지 않는다 (CALC 02) */
  otherRevenue?: number;
  deductions: { kind: DeductionKind; amount: number }[]; // 주문에 따라 변하는 배민 공제 (기간 합계)
  cogs: CogsInput;
  packaging: number | null; // 기간 포장비 합계, null = 미입력
  directFixed: Q | null; // 배민 전용 기간 비용 합계(정액 광고 등), null = 미확인
  commonAllocated: Q | null; // 배민에 배분한 공통비, null = 미입력
}

export interface ChannelResult {
  N: number;
  G: Q;
  D: Q;
  R: Q;
  /** 매장 귀속 배달 수입 등 (음식 순매출과 분리해서 표시) */
  otherRevenue: Q;
  deductionsByKind: Record<DeductionKind, Q>;
  deductionTotal: Q;
  cogs: Q | null;
  /** 재료원가 중 메뉴별 직접 원가가 적용된 판매액 비중 */
  detailedShare: Q | null;
  packaging: Q | null;
  variableTotal: Q | null;
  /** 배민 공헌이익 = R − 변동비 */
  cm: Q | null;
  directFixed: Q | null;
  /** 배민 직접비 차감 후 잔여액 */
  direct: Q | null;
  commonAllocated: Q | null;
  /** 공통비 배분 후 배민 손익 */
  allocated: Q | null;
  flags: {
    cogsMissing: boolean;
    cogsEstimated: boolean; // 원가율 추정이 들어감
    packagingMissing: boolean; // 포장비 제외 추정
    directMissing: boolean;
    commonMissing: boolean;
    hasUnclassified: boolean;
  };
}

/**
 * 재료원가: 메뉴별 직접 원가가 있는 매출에는 그 원가를, 나머지 매출에만 원가율을 적용한다 (CALC 04).
 * 1만원 메뉴 A(원가 4천원 입력) + 1만원 메뉴 B(원가율 30%) → 7천원, 상세 원가 비중 50%
 */
export function computeCogs(cogs: CogsInput, G: Q, R: Q): { cogs: Q | null; detailedShare: Q | null; estimated: boolean } {
  const detailed = cogs.detailed ?? [];
  const detailedSales = Q.sum(detailed.map((d) => d.sales));
  const detailedCost = Q.sum(detailed.map((d) => d.cost));
  const restGross = G.sub(detailedSales);
  const detailedShare = safeDiv(detailedSales, G);

  if (restGross.cmp(0) <= 0) return { cogs: detailedCost, detailedShare, estimated: false };
  if (cogs.ratePct === null) return { cogs: null, detailedShare, estimated: false };

  // 분모가 순매출이면 나머지 매출의 순매출 몫(할인 비례)만큼 적용
  const restBase = cogs.base === "gross" ? restGross : R.mul(restGross).div(G);
  return { cogs: detailedCost.add(restBase.mul(Q.pct(cogs.ratePct))), detailedShare, estimated: true };
}

export function computeChannel(input: ChannelInput): ChannelResult {
  const G = Q.of(input.grossSales);
  const D = Q.of(input.ownerDiscount);
  const R = G.sub(D);
  const otherRevenue = Q.of(input.otherRevenue ?? 0);

  const byKind = { brokerage: Q.ZERO, payment: Q.ZERO, delivery: Q.ZERO, other: Q.ZERO, unclassified: Q.ZERO };
  for (const d of input.deductions) byKind[d.kind] = byKind[d.kind].add(d.amount);
  const deductionTotal = Q.sum(Object.values(byKind));

  const c = computeCogs(input.cogs, G, R);
  const packagingInCogs = input.cogs.includesPackaging && c.cogs !== null;
  const packaging = packagingInCogs ? Q.ZERO : input.packaging === null ? null : Q.of(input.packaging);
  const packagingMissing = !packagingInCogs && input.packaging === null;

  // 포장비만 모르면 '포장비 제외 추정'으로 계속 계산, 재료원가를 모르면 공헌이익은 계산하지 않는다
  const variableTotal = c.cogs === null ? null : deductionTotal.add(c.cogs).add(packaging ?? Q.ZERO);
  // 공헌이익 = 음식 순매출 + 매장 귀속 배달 수입 − 변동비
  const cm = variableTotal === null ? null : R.add(otherRevenue).sub(variableTotal);
  const direct = cm === null || input.directFixed === null ? null : cm.sub(input.directFixed);
  const allocated = direct === null || input.commonAllocated === null ? null : direct.sub(input.commonAllocated);

  return {
    N: input.orders,
    G,
    D,
    R,
    otherRevenue,
    deductionsByKind: byKind,
    deductionTotal,
    cogs: c.cogs,
    detailedShare: c.detailedShare,
    packaging,
    variableTotal,
    cm,
    directFixed: input.directFixed,
    direct,
    commonAllocated: input.commonAllocated,
    allocated,
    flags: {
      cogsMissing: c.cogs === null,
      cogsEstimated: c.estimated,
      packagingMissing,
      directMissing: input.directFixed === null,
      commonMissing: input.commonAllocated === null,
      hasUnclassified: !byKind.unclassified.isZero(),
    },
  };
}

export type Scope = "direct" | "allocated";

export const SCOPE_LABEL: Record<Scope, string> = {
  direct: "인건비·월세 빼기 전",
  allocated: "인건비·월세까지 뺀 뒤",
};

/** 첫 화면 두 카드: 같은 기간·같은 범위의 기간 잔여액 P 와 P/N */
export function headline(r: ChannelResult, scope: Scope) {
  const period = scope === "direct" ? r.direct : r.allocated;
  return {
    period,
    perOrder: r.N > 0 ? safeDiv(period, Q.of(r.N)) : null,
    ratio: safeDiv(period, r.R), // 할인 후 순매출 대비
  };
}

/** 이 범위에서 고정비로 회수해야 하는 금액 */
export function fixedFor(r: ChannelResult, scope: Scope): Q | null {
  if (r.directFixed === null) return null;
  if (scope === "direct") return r.directFixed;
  return r.commonAllocated === null ? null : r.directFixed.add(r.commonAllocated);
}

/** 기간 합계 기반 비율 (월별 비율의 단순 평균 금지, AC 52) */
export function ratioOfTotals(parts: { numerator: number; denominator: number }[]): Q | null {
  return safeDiv(Q.sum(parts.map((p) => p.numerator)), Q.sum(parts.map((p) => p.denominator)));
}
