// 명시적인 데모 자료. 실제 배민 요율이나 어느 매장의 실적도 아니다.
import { addDays, monthRange, monthsBetween, presetRange } from "./engine/period";
import type { Business, DailyRow, MenuDay } from "./dataset";
import type { DeductionKind } from "./engine/profit";

/**
 * 사업자 A: PRD 12장 계산 검증 예시를 30일치 일별 자료로 나눈 것.
 * 주문 2,000건(하루 67건 20일 + 66건 10일), 주문당 판매액 20,000원·점주 할인 1,000원,
 * 중개 1,400·결제 600·배달 3,000·기타 200원, 원가율 30%, 포장비 500원,
 * 기간 광고 1,200,000원(배민 전용), 기간 공통비 배분 9,000,000원.
 */
function exampleRows(start: string): DailyRow[] {
  return Array.from({ length: 30 }, (_, i) => {
    const orders = i < 20 ? 67 : 66;
    return {
      date: addDays(start, i),
      orders,
      gross: orders * 20_000,
      discount: orders * 1_000,
      deductions: { brokerage: orders * 1_400, payment: orders * 600, delivery: orders * 3_000, other: orders * 200 },
    };
  });
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

/** 사업자 B: 200일치 가상 매장. 요일·계절 변동과 일부 미분류 차감을 넣었다. */
function storeBRows(b: { start: string; end: string; gap: { start: string; end: string } }): DailyRow[] {
  const rand = seeded(20260917);
  const rows: DailyRow[] = [];
  for (let d = b.start; d <= b.end; d = addDays(d, 1)) {
    const noise = rand();
    if (d >= b.gap.start && d <= b.gap.end) continue;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 5 || dow === 6;
    const month = Number(d.slice(5, 7));
    const orders = Math.round((weekend ? 48 : 34) * (month >= 7 ? 1.12 : 1) * (0.85 + noise * 0.3));
    const avg = 23_000 + Math.round(noise * 30) * 100;
    const gross = orders * avg;
    const discount = Math.round(orders * (weekend ? 1_500 : 1_000));
    const brokerage = Math.round(gross * 0.068);
    const payment = Math.round((gross - discount) * 0.03);
    rows.push({
      date: d,
      orders,
      gross,
      discount,
      deductions: {
        brokerage,
        payment,
        delivery: orders * 2_900,
        other: orders * 150,
        unclassified: d.endsWith("-15") ? 12_000 : 0,
      },
    });
  }
  return rows;
}

/**
 * 사업자 C: 처음부터 만든 가상 국밥집 (어느 실제 가게의 자료도 쓰지 않았다).
 * 112일치 일별 주문·메뉴·옵션·정산·광고 자료를 시드가 고정된 난수로 만든다.
 * A·B와 달리 메뉴별 수익성·정산 대조·광고 효율(우리가게클릭)까지 채워져 있어,
 * 실제 수집 뒤 화면이 어떻게 보이는지 시연할 수 있다. 날짜는 오늘 기준으로 다시 계산한다.
 */
const C_DAYS = 112;
const C_MENUS = [
  { name: "순대국밥", price: 9_000, weight: 30, soup: true },
  { name: "돼지국밥", price: 9_000, weight: 22, soup: true },
  { name: "얼큰 순대국밥", price: 10_000, weight: 18, soup: true },
  { name: "내장탕", price: 11_000, weight: 8, soup: true },
  { name: "뼈해장국", price: 11_000, weight: 7, soup: true },
  { name: "국밥 정식", price: 13_000, weight: 5, soup: true },
  { name: "수육 (소)", price: 20_000, weight: 6, soup: false },
  { name: "모둠 수육 (중)", price: 28_000, weight: 3, soup: false },
];
const C_OPTIONS = [
  { name: "곱빼기", price: 2_000, chance: 0.22 },
  { name: "순대 추가", price: 3_000, chance: 0.12 },
  { name: "공기밥 추가", price: 1_000, chance: 0.18 },
  { name: "수육 추가", price: 5_000, chance: 0.06 },
];

interface CDay {
  date: string;
  orders: number;
  gross: number;
  discount: number;
  otherRevenue: number;
  deductions: Record<DeductionKind, number>;
  menus: Record<string, MenuDay>;
  /** 그날 우리가게클릭 광고비 (부가세 별도) */
  cpc: number;
}

const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const round5 = (n: number) => Math.round(n / 5) * 5;

function storeCDays(start: string): CDay[] {
  const rand = seeded(20261012);
  const totalWeight = C_MENUS.reduce((a, m) => a + m.weight, 0);
  const pickMenu = () => {
    let r = rand() * totalWeight;
    for (const m of C_MENUS) {
      r -= m.weight;
      if (r <= 0) return m;
    }
    return C_MENUS[0];
  };

  return Array.from({ length: C_DAYS }, (_, i) => {
    const date = addDays(start, i);
    const dow = dayOfWeek(date);
    const weekend = dow === 0 || dow === 5 || dow === 6;
    const growth = 1 + (i / C_DAYS) * 0.15; // 석 달 사이 조금씩 늘어난 가게
    const orders = Math.max(1, Math.round((weekend ? 52 : 38) * growth * (0.8 + rand() * 0.4)));

    const menus: Record<string, MenuDay> = {};
    let gross = 0;
    let discount = 0;
    for (let o = 0; o < orders; o++) {
      const itemCount = rand() < 0.7 ? 1 : rand() < 0.83 ? 2 : 3;
      const orderDiscount = rand() < 0.1 ? (weekend ? 3_000 : 2_000) : 0;
      const seen = new Set<string>();
      for (let k = 0; k < itemCount; k++) {
        const m = pickMenu();
        const day = (menus[m.name] ??= { qty: 0, sales: 0, discount: 0, orders: 0, options: {} });
        const options = (day.options ??= {});
        let sales = m.price;
        if (m.soup) {
          for (const opt of C_OPTIONS) {
            if (rand() < opt.chance) {
              sales += opt.price;
              const od = (options[opt.name] ??= { qty: 0, sales: 0 });
              od.qty += 1;
              od.sales += opt.price;
            }
          }
        }
        day.qty += 1;
        day.sales += sales;
        if (!seen.has(m.name)) {
          seen.add(m.name);
          day.orders += 1;
        }
        if (k === 0 && orderDiscount) day.discount += orderDiscount;
        gross += sales;
      }
      discount += orderDiscount;
    }

    const net = gross - discount;
    const brokerage = Math.round(net * 0.068);
    const payment = Math.round(net * 0.03);
    const delivery = Math.round((orders * (2_400 + rand() * 200)) / 10) * 10;
    const other = Math.round((brokerage + payment + delivery) * 0.1);
    return {
      date,
      orders,
      gross,
      discount,
      otherRevenue: orders * (650 + Math.round(rand() * 100)),
      deductions: { brokerage, payment, delivery, other, unclassified: 0 },
      menus,
      cpc: round5(weekend ? 14_000 + rand() * 12_000 : 9_000 + rand() * 7_000),
    };
  });
}

const cDeductionTotal = (d: CDay) => Object.values(d.deductions).reduce((a, n) => a + n, 0);

/** 금~일은 한 번에, 나머지는 하루씩 정산. 입금은 마지막 날 3일 뒤. 가장 최근 입금 한 건은 아직 '입금요청'(입금 전) */
function storeCSettlements(days: CDay[], today: string) {
  const out: NonNullable<Business["settlements"]> = [];
  let i = 0;
  let n = 0;
  while (i < days.length) {
    const span = dayOfWeek(days[i].date) === 5 && i + 2 < days.length ? 3 : 1;
    const part = days.slice(i, i + span);
    const adCost = round5(part.reduce((a, d) => a + d.cpc * 1.1, 0)); // 정산서 광고비는 부가세 포함
    const revenue = part.reduce((a, d) => a + d.gross - d.discount - cDeductionTotal(d) + d.otherRevenue, 0);
    const adjustment = n % 9 === 4 ? 15_000 : 0;
    const depositDueDate = addDays(part[part.length - 1].date, 3);
    out.push({
      giveId: 700_000 + n,
      depositDueDate,
      status: depositDueDate >= addDays(today, -1) ? "입금요청" : "입금완료",
      settlePeriod: { start: part[0].date, end: part[part.length - 1].date },
      depositAmount: revenue - adCost + adjustment,
      adCost,
      adjustment,
    });
    i += span;
    n += 1;
  }
  return out.sort((a, b) => (a.depositDueDate < b.depositDueDate ? 1 : a.depositDueDate > b.depositDueDate ? -1 : 0));
}

/** 가게통계의 월별 광고 효율 자료 (최근 석 달). 월 광고비는 부가세 별도 */
function storeCMarketing(days: CDay[]) {
  const months = [...new Set(days.map((d) => d.date.slice(0, 7)))].sort().slice(-3);
  const out: NonNullable<Business["marketingByMonth"]> = {};
  for (const m of months) {
    const ds = days.filter((d) => d.date.startsWith(m));
    const orderCount = ds.reduce((a, d) => a + d.orders, 0);
    const orderAmount = ds.reduce((a, d) => a + d.gross, 0);
    out[m] = {
      orderCount,
      orderAmount,
      groups: {
        CPC: {
          cost: round5(ds.reduce((a, d) => a + d.cpc, 0)),
          orderCount: Math.round(orderCount * 0.78),
          orderAmount: Math.round((orderAmount * 0.8) / 100) * 100,
        },
        BAEMIN_CLUB: { cost: 30_000, orderCount: Math.round(orderCount * 0.55), orderAmount: Math.round((orderAmount * 0.56) / 100) * 100 },
        INSTANT_DISCOUNT: { cost: 0, orderCount: Math.round(orderCount * 0.6), orderAmount: Math.round((orderAmount * 0.62) / 100) * 100 },
        TIME_SALE: { cost: 0, orderCount: 0, orderAmount: 0 },
      },
    };
  }
  return out;
}

/** 배민 전용 비용 — 일별 광고비 + 월 이용료. 실제 수집과 같이 id가 auto- 로 시작해 '자동으로 가져온 비용'으로 접혀 보인다 */
function storeCDirectCosts(days: CDay[]) {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const daily = days.map((d) => {
    const [, m, dd] = d.date.split("-").map(Number);
    return {
      id: `auto-cpc-${d.date}`,
      label: `우리가게클릭 광고비 (${m}/${dd}, 정산 기준)`,
      amount: round5(d.cpc * 1.1),
      start: d.date,
      end: d.date,
    };
  });
  const monthly = monthsBetween(first.slice(0, 7), last.slice(0, 7)).map((m) => {
    const r = monthRange(m);
    return {
      id: `auto-club-${m}`,
      label: `배민클럽 이용료 (${Number(m.slice(5))}월, 자동 수집)`,
      amount: 30_000,
      start: r.start < first ? first : r.start,
      end: r.end > last ? last : r.end,
    };
  });
  return [...monthly, ...daily];
}

function demoCBusiness(today: string): Business {
  const start = addDays(today, -C_DAYS);
  const days = storeCDays(start);
  const rows: DailyRow[] = days.map((d) => ({
    date: d.date,
    orders: d.orders,
    gross: d.gross,
    discount: d.discount,
    otherRevenue: d.otherRevenue,
    deductions: d.deductions,
    menus: d.menus,
  }));
  const range = { start: rows[0].date, end: rows[rows.length - 1].date };
  const totalGross = rows.reduce((a, r) => a + r.gross, 0);
  const commonTotal = Math.round((totalGross * 0.22) / 10_000) * 10_000; // 예시용 인건비·월세 배민 몫(전체 기간)

  return {
    id: "biz-c",
    name: "예시 가게 C (정산·광고 자료까지 있는 예)",
    demo: true,
    stores: [{ id: "store-c1", name: "예시 얼큰국밥집", collected: [range], rows }],
    settings: {
      cogs: { ratePct: 32, base: "gross", includesPackaging: false },
      packagingPerOrder: 350,
      directCosts: storeCDirectCosts(days),
      commonCosts: [{ id: "c-common", label: "인건비·월세 배민 몫 (예시)", amount: commonTotal, ...range }],
      noDirectCosts: false,
      noCommonCosts: false,
      closedDays: 0,
      // 메뉴마다 원가 차이를 둬서 '빠듯한 메뉴'가 화면에 드러나게 한다 (가상 값)
      menuCosts: { 순대국밥: 3_900, 돼지국밥: 4_100, "얼큰 순대국밥": 4_500, 내장탕: 5_300, 뼈해장국: 5_600, "국밥 정식": 8_200, "수육 (소)": 9_000, "모둠 수육 (중)": 21_500 },
    },
    marketingByMonth: storeCMarketing(days),
    settlements: storeCSettlements(days, today),
  };
}

/** 데모 자료는 오늘(한국 날짜) 기준으로 만든다. 사업자 A는 항상 '최근 한 달' 30일을 채운다. */
export function demoBusinesses(today: string): Business[] {
  const a = presetRange("1m", today); // 어제까지 30일
  const b = { start: addDays(today, -200), end: addDays(today, -1), gap: { start: addDays(today, -100), end: addDays(today, -96) } };
  const bMonths = monthsBetween(b.start.slice(0, 7), b.end.slice(0, 7));

  return [
    {
      id: "biz-a",
      name: "예시 가게 A (모든 값이 채워진 예)",
      demo: true,
      stores: [{ id: "store-a1", name: "예시 국밥집", collected: [a], rows: exampleRows(a.start) }],
      settings: {
        cogs: { ratePct: 30, base: "gross", includesPackaging: false },
        packagingPerOrder: 500,
        directCosts: [{ id: "a-ad", label: "정액 광고 예산", amount: 1_200_000, ...a }],
        commonCosts: [{ id: "a-common", label: "인건비·월세 배민 배분", amount: 9_000_000, ...a }],
        noDirectCosts: false,
        noCommonCosts: false,
        closedDays: 0,
      },
    },
    {
      id: "biz-b",
      name: "예시 가게 B (값이 덜 채워진 예)",
      demo: true,
      stores: [
        {
          id: "store-b1",
          name: "예시 분식집",
          collected: [
            { start: b.start, end: addDays(b.gap.start, -1) },
            { start: addDays(b.gap.end, 1), end: b.end },
          ],
          rows: storeBRows(b),
        },
      ],
      settings: {
        cogs: { ratePct: 35, base: "gross", includesPackaging: false },
        packagingPerOrder: null,
        directCosts: bMonths.map((m) => ({
          id: `b-ad-${m}`,
          label: `${Number(m.slice(5))}월 정액 광고`,
          amount: 450_000,
          ...monthRange(m),
        })),
        commonCosts: [],
        noDirectCosts: false,
        noCommonCosts: false,
        closedDays: 0,
      },
    },
    demoCBusiness(today),
  ];
}
