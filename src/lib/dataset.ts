// 사업자 · 매장 · 일별 자료 모델과 기간 집계. 수집 경로(원격 수집·파일·수기)와 무관한 내부 형식.
import { Q } from "./engine/rational";
import { type DateRange, type DatedCost, coverage, inRange, prorate } from "./engine/period";
import type { ChannelInput, CogsInput, DeductionKind } from "./engine/profit";

export interface DailyRow {
  date: string;
  orders: number;
  gross: number;
  discount: number;
  /** 매장 귀속 배달팁 등 음식대금 외 수입 */
  otherRevenue?: number;
  deductions: Partial<Record<DeductionKind, number>>;
  /** 그날 팔린 메뉴 (판매액에는 그 메뉴에 붙은 유료 옵션이 포함됨) */
  menus?: Record<string, MenuDay>;
}

export interface MenuDay {
  qty: number;
  sales: number;
  discount: number;
  orders: number;
  options?: Record<string, { qty: number; sales: number }>;
}

export interface MenuTotal {
  name: string;
  qty: number;
  sales: number;
  discount: number;
  orders: number;
  options: { name: string; qty: number; sales: number }[];
}

/** 선택 기간의 메뉴별 합계 (판매액 큰 순) */
export function menuTotals(store: Store, range: DateRange): MenuTotal[] {
  const acc = new Map<string, MenuTotal>();
  for (const row of store.rows) {
    if (!inRange(row.date, range)) continue;
    for (const [name, m] of Object.entries(row.menus ?? {})) {
      const t = acc.get(name) ?? { name, qty: 0, sales: 0, discount: 0, orders: 0, options: [] };
      t.qty += m.qty;
      t.sales += m.sales;
      t.discount += m.discount;
      t.orders += m.orders;
      const opts = new Map(t.options.map((o) => [o.name, o]));
      for (const [oname, o] of Object.entries(m.options ?? {})) {
        const prev = opts.get(oname) ?? { name: oname, qty: 0, sales: 0 };
        prev.qty += o.qty;
        prev.sales += o.sales;
        opts.set(oname, prev);
      }
      t.options = [...opts.values()].sort((a, b) => b.sales - a.sales);
      acc.set(name, t);
    }
  }
  return [...acc.values()].sort((a, b) => b.sales - a.sales);
}

export interface CostSettings {
  cogs: CogsInput;
  /** 주문 1건당 포장비(원), null = 미입력 */
  packagingPerOrder: number | null;
  directCosts: DatedCost[];
  commonCosts: DatedCost[];
  /** 배민 전용 기간 비용이 정말 없다고 확인함 */
  noDirectCosts: boolean;
  /** 배민에 배분할 공통비를 0원으로 확인함 */
  noCommonCosts: boolean;
  /** 선택 기간 중 휴무일 수 */
  closedDays: number;
  /** 메뉴 1개당 재료원가(원). 넣은 메뉴만 상세 원가로 계산하고 나머지는 원가율 추정 */
  menuCosts?: Record<string, number>;
  /** v6: 본사 가격이라 메뉴 가격을 사장님이 못 정함 → 가격 인상 대신 다른 제안을 보여 준다 */
  priceLocked?: boolean;
}

export interface Store {
  id: string;
  name: string;
  /** 자료가 실제로 확인된 기간 */
  collected: DateRange[];
  rows: DailyRow[];
}

export interface Business {
  id: string;
  name: string;
  stores: Store[];
  settings: CostSettings;
  /** 가상 데모 자료인지 (실제 수집 자료는 false) */
  demo: boolean;
  /** v7: 정산·광고 자료까지 보여 주는 예시 가게(가게 C)용. 실제 수집 자료(StoreDataFile)와 같은 모양 */
  marketingByMonth?: Record<string, { orderCount: number; orderAmount: number; groups: Record<string, { cost: number | null; orderCount: number; orderAmount: number }> }>;
  settlements?: { giveId: number; depositDueDate: string; status: string; settlePeriod: DateRange; depositAmount: number; adCost: number; adjustment: number }[];
}

export function aggregate(store: Store, s: CostSettings, range: DateRange) {
  const rows = store.rows.filter((r) => inRange(r.date, range));
  const sum = (f: (r: DailyRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const orders = sum((r) => r.orders);
  const kinds: DeductionKind[] = ["brokerage", "payment", "delivery", "other", "unclassified"];

  const direct = prorate(s.directCosts, range);
  const common = prorate(s.commonCosts, range);
  const cov = coverage(range, store.collected);

  // 메뉴 1개당 원가를 넣은 메뉴만 상세 원가로 계산한다 (나머지는 원가율 추정, 중복 적용 없음)
  const menus = menuTotals(store, range);
  const detailed = menus
    .filter((m) => Number.isFinite(s.menuCosts?.[m.name]) && (s.menuCosts?.[m.name] ?? 0) >= 0)
    .map((m) => ({ menu: m.name, sales: m.sales, cost: (s.menuCosts?.[m.name] ?? 0) * m.qty }));

  const input: ChannelInput = {
    orders,
    grossSales: sum((r) => r.gross),
    ownerDiscount: sum((r) => r.discount),
    otherRevenue: sum((r) => r.otherRevenue ?? 0),
    deductions: kinds.map((kind) => ({ kind, amount: sum((r) => r.deductions[kind] ?? 0) })),
    cogs: detailed.length ? { ...s.cogs, detailed } : s.cogs,
    packaging: s.packagingPerOrder === null ? null : s.packagingPerOrder * orders,
    directFixed: s.directCosts.length || s.noDirectCosts ? direct.total : null,
    commonAllocated: s.commonCosts.length || s.noCommonCosts ? common.total : null,
  };

  // 영업일: 자료가 있는 날 − 휴무일 (자료 없는 날을 영업일로 세지 않음)
  const businessDays = Math.max(0, cov.coveredDays - s.closedDays);
  return { input, coverage: cov, directParts: direct.parts, commonParts: common.parts, businessDays, rowCount: rows.length, menus };
}

/** 일별 추이 (선택 기간 내 자료가 있는 날만) */
export function dailySeries(store: Store, range: DateRange) {
  return store.rows
    .filter((r) => inRange(r.date, range))
    .map((r) => ({ date: r.date, orders: r.orders, net: Q.of(r.gross - r.discount) }));
}

export interface WeekdayStat {
  /** 0=일 … 6=토 */
  day: number;
  label: string;
  /** 자료가 있는 날 수 */
  days: number;
  avgOrders: number;
  /** 하루 평균, 할인 뺀 매출 */
  avgNet: number;
  /** 하루 평균, 중개이용료·결제수수료·배달비 등을 낸 뒤 금액 (재료비·포장비·광고비 빼기 전) */
  avgAfterDeductions: number;
}

const WEEKDAY_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일별 하루 평균. 자료가 없는 날은 날 수에 넣지 않는다(0원으로 채우지 않음). */
export function weekdayStats(store: Store, range: DateRange): WeekdayStat[] {
  const acc = WEEKDAY_LABEL.map((label, day) => ({ day, label, days: 0, orders: 0, net: 0, after: 0 }));
  for (const r of store.rows) {
    if (!inRange(r.date, range)) continue;
    const [y, m, d] = r.date.split("-").map(Number);
    const a = acc[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    const deducted = Object.values(r.deductions).reduce<number>((s, v) => s + (v ?? 0), 0);
    a.days += 1;
    a.orders += r.orders;
    a.net += r.gross - r.discount;
    a.after += r.gross - r.discount + (r.otherRevenue ?? 0) - deducted;
  }
  // 월~일 순서로 돌려준다
  return [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const a = acc[i];
    return {
      day: a.day,
      label: a.label,
      days: a.days,
      avgOrders: a.days ? a.orders / a.days : 0,
      avgNet: a.days ? a.net / a.days : 0,
      avgAfterDeductions: a.days ? a.after / a.days : 0,
    };
  });
}

/**
 * 화면에 쓰는 자료가 말이 되는지 검산한다. 문제가 없으면 빈 목록.
 * (같은 날짜가 두 번 들어가면 합계가 두 배가 되므로 가장 먼저 본다)
 */
export function verifyStore(store: Store, range: DateRange): string[] {
  const issues: string[] = [];
  const rows = store.rows.filter((r) => inRange(r.date, range));
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const r of rows) (seen.has(r.date) ? dup : seen).add(r.date);
  if (dup.size) issues.push(`같은 날짜가 두 번 들어 있어요(${[...dup].slice(0, 3).join(", ")}${dup.size > 3 ? " 외" : ""}). 합계가 부풀려졌을 수 있어요.`);
  const bad = rows.filter((r) => ![r.orders, r.gross, r.discount].every(Number.isFinite) || r.orders < 0 || r.gross < 0);
  if (bad.length) issues.push(`주문 수·매출이 비정상인 날이 ${bad.length}일 있어요(${bad[0].date} 등).`);
  const over = rows.filter((r) => r.discount > r.gross);
  if (over.length) issues.push(`할인이 매출보다 큰 날이 ${over.length}일 있어요(${over[0].date} 등).`);
  const withMenus = rows.filter((r) => r.menus && Object.keys(r.menus).length);
  if (withMenus.length) {
    const g = withMenus.reduce((a, r) => a + r.gross, 0);
    const m = withMenus.reduce((a, r) => a + Object.values(r.menus ?? {}).reduce((s, x) => s + x.sales, 0), 0);
    if (g > 0 && Math.abs(m - g) / g > 0.02) issues.push("메뉴별 판매액을 모두 더한 값이 전체 매출과 2% 넘게 달라요. 메뉴별 숫자는 참고만 해 주세요.");
  }
  return issues;
}
