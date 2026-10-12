// 수집한 배민 원본(data/collect/orders-*.json)을 앱이 쓰는 일별 자료로 바꾼다.
// 실제 응답에서 확인된 항목 코드만 분류하고, 처음 보는 코드는 '미분류'로 남긴다 (PRD LEDGER 01).
//
// 사용: node scripts/normalize-baemin.mjs   → data/store-data.json

import fs from "node:fs";
import path from "node:path";
import { ROOT, log } from "./lib/browser.mjs";

/** 2026-09-18 수집에서 실제로 확인한 항목 코드 */
const CODES = {
  // 매출
  ORDER_AMOUNT: { as: "gross", label: "주문금액" },
  DELIVERY_TIP_AMOUNT: { as: "otherRevenue", label: "가게배달팁" },
  BARO_WOOWABROS_CHARGE_DELIVERY_TIP: { as: "otherRevenue", label: "배민 부담 가게배달팁" },
  // 점주 부담 할인
  DISCOUNT_AMOUNT: { as: "discount", label: "고객할인비용" },
  // 비용
  ADVERTISE_FEE: { as: "brokerage", label: "중개이용료" },
  SERVICE_FEE: { as: "payment", label: "결제정산수수료" },
  DELIVERY_SUPPLY_PRICE: { as: "delivery", label: "배달비" },
  DEVLIERY_TIP_INSTANT_DISCOUNT: { as: "delivery", label: "배달팁 할인비용" },
  BAEMIN_CLUB_INSTANT_DISCOUNT: { as: "delivery", label: "배민클럽 할인비용" },
};

const collectDir = path.join(ROOT, "data", "collect");
const files = fs.existsSync(collectDir) ? fs.readdirSync(collectDir).filter((f) => f.startsWith("orders-")) : [];
if (!files.length) {
  log("수집한 자료가 없습니다. 먼저 node scripts/collect-baemin.mjs 를 실행해 주세요.");
  process.exit(1);
}

let storeInfo = null; // 수집 파일에 기록된 가게 정보 (매장 이름 표시용)
const days = new Map(); // 날짜 → 합계
const unknown = new Map();
const unsettledDates = new Map();
let settledOrders = 0;
let unsettledOrders = 0;
let meetOrders = 0;
let requestedStart = null;
let requestedEnd = null;
const seen = new Set();

function day(date) {
  if (!days.has(date))
    days.set(date, {
      date,
      orders: 0,
      gross: 0,
      discount: 0,
      otherRevenue: 0,
      deductions: { brokerage: 0, payment: 0, delivery: 0, other: 0, unclassified: 0 },
      menus: {},
    });
  return days.get(date);
}

/** 주문 안의 메뉴·옵션을 날짜별로 모은다. 메뉴 판매액에는 그 메뉴에 붙은 유료 옵션이 포함된다. */
function addMenus(d, order) {
  for (const it of order.items ?? []) {
    const name = (it.name ?? "").trim();
    if (!name) continue;
    const m = (d.menus[name] ??= { qty: 0, sales: 0, discount: 0, orders: 0, options: {} });
    m.qty += it.quantity ?? 0;
    m.sales += it.totalPrice ?? 0;
    m.discount += it.discountPrice ?? 0;
    m.orders += 1;
    for (const op of it.options ?? []) {
      const oname = (op.name ?? "").trim();
      if (!oname || !op.price) continue;
      const o = (m.options[oname] ??= { qty: 0, sales: 0 });
      o.qty += it.quantity ?? 1;
      o.sales += (op.price ?? 0) * (it.quantity ?? 1);
    }
  }
}

for (const f of files.sort()) {
  const raw = JSON.parse(fs.readFileSync(path.join(collectDir, f), "utf8"));
  if (raw.store && (raw.store.shopOwnerName || raw.store.shops?.length)) storeInfo = raw.store;
  requestedStart = requestedStart === null || raw.range.start < requestedStart ? raw.range.start : requestedStart;
  requestedEnd = requestedEnd === null || raw.range.end > requestedEnd ? raw.range.end : requestedEnd;

  for (const o of raw.orders ?? []) {
    const no = o.order?.orderNumber;
    if (no && seen.has(no)) continue; // 같은 주문을 두 파일에서 받아도 한 번만 센다
    if (no) seen.add(no);

    const date = String(o.order?.orderDateTime ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const s = o.settle ?? {};
    const settled = Boolean(s.total) && !s.notDisplayReason;
    if (!settled) {
      unsettledOrders++;
      unsettledDates.set(date, (unsettledDates.get(date) ?? 0) + 1);
      continue; // 정산 전 주문은 비용이 비어 있어 손익을 왜곡하므로 제외하고 따로 알린다
    }
    settledOrders++;
    if (s.meetAmount) meetOrders++;

    const d = day(date);
    d.orders++;
    addMenus(d, o.order ?? {});
    for (const key of ["orderBrokerageItems", "deliveryItems", "etcItems"]) {
      for (const it of s[key] ?? []) {
        const rule = CODES[it.code];
        const amount = it.amount ?? 0;
        if (!rule) {
          if (amount !== 0) {
            unknown.set(`${it.code} · ${it.name}`, (unknown.get(`${it.code} · ${it.name}`) ?? 0) + 1);
            if (amount < 0) d.deductions.unclassified += -amount;
          }
          continue;
        }
        if (rule.as === "gross") d.gross += amount;
        else if (rule.as === "otherRevenue") d.otherRevenue += amount;
        else if (rule.as === "discount") d.discount += -amount;
        else d.deductions[rule.as] += -amount; // 비용은 음수로 오므로 부호를 뒤집어 양수 비용으로 저장
      }
    }
    // 공제액에 붙는 부가세 (간편 분석에서는 정산에서 빠지는 금액 그대로 비용으로 본다)
    d.deductions.other += -(s.deductionAmountTotalVat ?? 0);
  }
}

const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
const lastDataDate = rows.length ? rows[rows.length - 1].date : null;

/**
 * 월별 광고·마케팅 비용 (가게통계 자료).
 * 주문별 자료와 겹치지 않는 것만 '배민 전용 기간 비용'으로 넘긴다.
 * - CPC(우리가게클릭), BAEMIN_CLUB(배민클럽 이용료): 주문별 정산에 없음 → 기간 비용으로 반영
 * - INSTANT_DISCOUNT(즉시할인), MFO: 주문별 '고객할인비용'에 이미 들어 있음 → 중복이라 제외
 *   (실측: 주문별 할인에 즉시할인·MFO가 이미 들어 있어 중복으로 더하지 않음)
 */
const AS_PERIOD_COST = { CPC: "우리가게클릭 광고비", BAEMIN_CLUB: "배민클럽 이용료" };
const ALREADY_IN_ORDERS = { INSTANT_DISCOUNT: "즉시할인", MFO: "만원의행복" };

const autoDirectCosts = [];
const marketingByMonth = {};
const adsFiles = fs.existsSync(collectDir) ? fs.readdirSync(collectDir).filter((f) => f.startsWith("ads-")) : [];
// 같은 달이 여러 파일에 들어 있으면(예: 9월 중간값과 최종값) 가장 나중에 받은 파일 하나만 쓴다
adsFiles.sort((a, b) => fs.statSync(path.join(collectDir, a)).mtimeMs - fs.statSync(path.join(collectDir, b)).mtimeMs);
for (const f of adsFiles) {
  const ads = JSON.parse(fs.readFileSync(path.join(collectDir, f), "utf8"));
  for (const [month, m] of Object.entries(ads.months ?? {})) {
    marketingByMonth[month] = {
      orderCount: m.orderCount,
      orderAmount: m.orderAmount,
      groups: Object.fromEntries(Object.entries(m.groups ?? {}).map(([g, v]) => [g, { cost: v.cost, orderCount: v.orderCount, orderAmount: v.orderAmount }])),
    };
    for (const [group, label] of Object.entries(AS_PERIOD_COST)) {
      const cost = m.groups?.[group]?.cost;
      if (!cost) continue;
      const [y, mm] = month.split("-").map(Number);
      const monthEnd = `${month}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, "0")}`;
      // 이번 달처럼 아직 안 끝난 달은 자료가 있는 마지막 날까지로 잡는다 (일할 배분이 어긋나지 않게)
      const end = lastDataDate && lastDataDate < monthEnd && lastDataDate >= `${month}-01` ? lastDataDate : monthEnd;
      autoDirectCosts.push({ id: `auto-${group}-${month}`, label: `${label} (${Number(month.slice(5))}월, 자동 수집)`, amount: cost, start: `${month}-01`, end });
    }
  }
}

{
  const byId = new Map();
  for (const c of autoDirectCosts) byId.set(c.id, c);
  autoDirectCosts.length = 0;
  autoDirectCosts.push(...byId.values());
}

// 자료가 실제로 있는 날만 이어 붙여 '확인된 기간'을 만든다 (빈 날을 0원으로 채우지 않기 위해)
const collected = [];
for (const r of rows) {
  const last = collected[collected.length - 1];
  const prev = last ? new Date(Date.parse(`${last.end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : null;
  if (last && prev === r.date) last.end = r.date;
  else collected.push({ start: r.date, end: r.date });
}

/**
 * 정산명세서(수집했다면): 일별 광고비와 정산 건별 입금액·조정 항목.
 * 광고비는 정산 명세의 일별 금액(부가세 포함)이 가장 정확하므로, 있으면 가게통계 월 합계 대신 이 값을 쓴다.
 */
const settlements = [];
const adByDate = new Map();
const adjustments = [];
// 정산명세서 파일은 기간이 겹치게 여러 번 쌓인다. 같은 정산(giveId)이 두 번 들어오면 광고비·입금액이 두 배가 되므로,
// 파일 이름(수집 시각) 순서대로 읽어 같은 정산은 가장 나중 것 하나만 쓴다 (입금 상태도 최신 값이 된다).
const settleByGive = new Map();
for (const f of (fs.existsSync(collectDir) ? fs.readdirSync(collectDir) : []).filter((f) => f.startsWith("settlements-")).sort()) {
  const doc = JSON.parse(fs.readFileSync(path.join(collectDir, f), "utf8"));
  for (const item of doc.details ?? []) {
    const s = item.summary ?? {};
    settleByGive.set(s.giveId ?? `${s.depositDueDate}-${s.giveAmount}`, item);
  }
}
{
  for (const { summary, detail } of settleByGive.values()) {
    const cpc = detail?.cpcDetails;
    const daily = cpc?.dailyDetails ?? [];
    const gross = Math.abs(cpc?.total ?? 0); // 부가세 포함 광고비
    const base = daily.reduce((a, d) => a + Math.abs(d.cpcAmount ?? 0), 0);
    for (const d of daily) {
      // 부가세를 일별 금액 비율로 나눠 붙인다 (합계는 명세서 총액과 같게)
      const share = base ? (Math.abs(d.cpcAmount ?? 0) / base) * gross : 0;
      adByDate.set(d.date, (adByDate.get(d.date) ?? 0) + share);
    }
    const etc = detail?.etcDetails ?? {};
    const adjTotal = (etc.adjustment?.adjustmentTotal ?? 0) + (etc.adjustment?.rewardTotal ?? 0) + (etc.adSupport?.total ?? 0);
    if (adjTotal) adjustments.push({ depositDueDate: summary.depositDueDate, amount: adjTotal, details: [...(etc.adjustment?.adjustmentDetails ?? []), ...(etc.adSupport?.adSupportDetails ?? [])] });
    settlements.push({
      giveId: summary.giveId,
      depositDueDate: summary.depositDueDate,
      status: summary.giveStatusName,
      settlePeriod: { start: summary.giveStartDate, end: summary.giveEndDate },
      depositAmount: summary.giveAmount,
      adCost: gross,
      adjustment: adjTotal,
    });
  }
}

if (adByDate.size) {
  // 정산 명세 기준 일별 광고비가 있으면, 통계 기준 월 광고비는 뺀다 (이중 반영 방지)
  for (let i = autoDirectCosts.length - 1; i >= 0; i--) if (autoDirectCosts[i].id.startsWith("auto-CPC-")) autoDirectCosts.splice(i, 1);
  for (const [date, amount] of [...adByDate].sort()) {
    autoDirectCosts.push({
      id: `auto-CPC-day-${date}`,
      label: `우리가게클릭 광고비 (${Number(date.slice(5, 7))}/${Number(date.slice(8))}, 정산 기준)`,
      amount: Math.round(amount),
      start: date,
      end: date,
    });
  }
}

const out = {
  store: {
    id: storeInfo?.shopOwnerNumber ? `shop-${storeInfo.shopOwnerNumber}` : "real-store",
    name: storeInfo?.shops?.[0]?.name ?? storeInfo?.shopOwnerName ?? "내 가게",
    shops: storeInfo?.shops ?? [],
  },
  settlements,
  adjustments,
  collectedAt: new Date().toISOString(),
  requested: { start: requestedStart, end: requestedEnd },
  collected,
  rows,
  autoDirectCosts,
  marketingByMonth,
  notes: {
    alreadyInOrders: Object.values(ALREADY_IN_ORDERS),
    settledOrders,
    unsettledOrders,
    unsettledDates: [...unsettledDates].sort(),
    meetOrders,
    unknownCodes: [...unknown],
    vatCountedAsCost: true,
  },
};
const file = path.join(ROOT, "data", "store-data.json");
fs.writeFileSync(file, JSON.stringify(out, null, 1), "utf8");

log(`일별 ${rows.length}일, 정산 완료 주문 ${settledOrders}건 → ${path.relative(ROOT, file)}`);
if (unsettledOrders) log(`정산 준비 중이라 제외한 주문 ${unsettledOrders}건 (${[...unsettledDates.keys()].sort().join(", ")})`);
if (unknown.size) log(`처음 보는 항목(미분류 처리): ${[...unknown].map(([k, v]) => `${k}(${v})`).join(", ")}`);
if (autoDirectCosts.length)
  log(`자동으로 넣은 배민 전용 비용: ${autoDirectCosts.map((c) => `${c.label} ${c.amount.toLocaleString("ko-KR")}원(${c.start}~${c.end})`).join(", ")}`);
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
log(
  `합계 확인 — 주문 ${sum((r) => r.orders)}건 · 주문금액 ${sum((r) => r.gross).toLocaleString("ko-KR")}원 · ` +
    `점주할인 ${sum((r) => r.discount).toLocaleString("ko-KR")}원 · 배달팁수입 ${sum((r) => r.otherRevenue).toLocaleString("ko-KR")}원 · ` +
    `공제 ${sum((r) => Object.values(r.deductions).reduce((a, b) => a + b, 0)).toLocaleString("ko-KR")}원`,
);
