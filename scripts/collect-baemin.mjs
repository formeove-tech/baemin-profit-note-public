// 배민 사장님 사이트에서 기간별 주문·정산 자료를 수집한다 (PRD DATA 01 '로그인 후 버튼 수집'의 로컬 시제품).
//
// 사용: node scripts/collect-baemin.mjs --start 2026-08-19 --end 2026-09-17 [--inspect]
//
// 방식: 사장님이 크롬에서 직접 로그인한 상태에서, 주문내역 화면이 스스로 보내는 조회 요청의
//       조회 조건(기간·건수)만 바꿔 같은 화면을 다시 불러오고 그 응답을 받아 적는다.
//       배민 서버에는 평범한 브라우저 조회로 나가며, 접근 제한을 우회하지 않는다.
//       메뉴·가격·광고는 건드리지 않고 조회만 한다. 받은 자료는 data/ 에만 저장한다(git 제외).

import fs from "node:fs";
import path from "node:path";
import { dataDir, log, openBrowser, sleep, waitForPage } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const INSPECT = argv.includes("--inspect");
const PAGE_SIZE = Number(arg("limit", "100"));

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const START = arg("start", addDays(today, -30));
const END = arg("end", addDays(today, -1));

const ORDERS_URL = "https://self.baemin.com/orders/history";

const ctx = await openBrowser("baemin");
const page = ctx.pages()[0] ?? (await ctx.newPage());

// 화면이 불러오는 가게 정보를 받아 적는다 (어느 매장 자료인지 남기기 위해)
const storeInfo = { shopOwnerNumber: null, shopOwnerName: null, shops: [] };
page.on("response", async (res) => {
  try {
    const url = res.url();
    if (!/self-api\.baemin\.com/.test(url) || res.status() !== 200) return;
    if (/\/v1\/session\/profile/.test(url)) {
      const b = await res.json();
      storeInfo.shopOwnerNumber ??= b?.shopOwnerNumber ?? null;
    } else if (/\/v4\/store\/shops\/search/.test(url)) {
      const b = await res.json();
      for (const s of b?.contents ?? []) {
        const no = s.shopNumber ?? s.shopNo ?? s.number ?? null;
        if (s.name && !storeInfo.shops.some((x) => x.name === s.name)) storeInfo.shops.push({ shopNumber: no, name: s.name });
      }
    } else if (/\/v4\/store\/shop-owners\/\d+$/.test(url)) {
      const b = await res.json();
      storeInfo.shopOwnerName ??= b?.shopOwnerName ?? null; // 사업자(가게) 이름
    }
  } catch {
    /* 무시 */
  }
});

// 화면이 보내는 주문 조회 요청의 조건만 바꿔치기한다
let cursor = { offset: 0, limit: PAGE_SIZE };
await page.route("**/v4/orders?**", async (route) => {
  const url = new URL(route.request().url());
  url.searchParams.set("startDate", START);
  url.searchParams.set("endDate", END);
  url.searchParams.set("offset", String(cursor.offset));
  url.searchParams.set("limit", String(cursor.limit));
  await route.continue({ url: url.toString() });
});

/** 화면을 다시 불러 현재 커서의 주문 목록을 받아온다 (가끔 늦게 떠서 몇 번 다시 시도한다) */
async function fetchChunk(tries = 3) {
  let lastError = null;
  for (let i = 1; i <= tries; i++) {
    try {
      const waiting = page.waitForResponse((r) => r.url().includes("/v4/orders?") && r.status() === 200, { timeout: 45_000 });
      await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
      return await (await waiting).json();
    } catch (e) {
      lastError = e;
      log(`주문 조회를 다시 시도합니다 (${i}/${tries})`);
      if (i < tries) await sleep(2500);
    }
  }
  throw lastError ?? new Error("주문을 받지 못했습니다");
}

log(`수집 기간 ${START} ~ ${END}`);
await page.goto(ORDERS_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

// 로그인 확인 (안 돼 있으면 사장님이 직접 로그인할 때까지 기다린다)
if (!/self\.baemin\.com/.test(page.url())) {
  log("배민 로그인이 필요합니다. 열린 크롬 창에서 직접 로그인해 주세요. (최대 10분 대기)");
  const ok = await waitForPage(page, () => location.host === "self.baemin.com", { message: "로그인을 기다리는 중…" });
  if (!ok) {
    log("로그인을 확인하지 못해 종료합니다.");
    await ctx.close().catch(() => {});
    process.exit(1);
  }
  await sleep(2000);
}

const orders = [];
const seen = new Set();
let totalSize = null;
let guard = 0;

while (guard++ < 400) {
  let body;
  try {
    body = await fetchChunk();
  } catch (e) {
    log(`조회 실패 (${cursor.offset}번째부터): ${String(e.message).split("\n")[0]}`);
    break;
  }
  const contents = body?.contents ?? [];
  totalSize ??= body?.totalSize ?? null;
  if (guard === 1) log(`조회 결과 총 ${totalSize}건, 한 번에 ${contents.length}건씩 받습니다.`);
  if (!contents.length) break;

  for (const o of contents) {
    const key = o.order?.orderNumber;
    if (key && seen.has(key)) continue; // 같은 주문을 두 번 세지 않는다
    if (key) seen.add(key);
    orders.push(o);
  }
  log(`${orders.length} / ${totalSize ?? "?"}건 수집`);
  if (totalSize !== null && orders.length >= totalSize) break;
  cursor = { offset: cursor.offset + contents.length, limit: contents.length };
  await sleep(600);
}

const outDir = dataDir("collect");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rawFile = path.join(outDir, `orders-${START}_${END}-${stamp}.json`);
fs.writeFileSync(
  rawFile,
  JSON.stringify({ store: storeInfo, range: { start: START, end: END }, totalSize, collectedAt: new Date().toISOString(), orders }, null, 1),
  "utf8",
);
log(`원본 ${orders.length}건 저장: ${path.relative(process.cwd(), rawFile)}`);

if (INSPECT) {
  const names = { orderBrokerageItems: new Map(), deliveryItems: new Map(), etcItems: new Map() };
  const reasons = new Map();
  let settled = 0;
  for (const o of orders) {
    const s = o.settle ?? {};
    if (s.notDisplayReason) reasons.set(s.notDisplayReason, (reasons.get(s.notDisplayReason) ?? 0) + 1);
    if (s.total) settled++;
    for (const key of Object.keys(names)) {
      for (const it of s[key] ?? []) {
        const label = it.name ?? it.title ?? it.type ?? it.code ?? Object.keys(it).join("+");
        names[key].set(label, (names[key].get(label) ?? 0) + 1);
      }
    }
  }
  log(`정산이 채워진 주문: ${settled} / ${orders.length}`);
  if (reasons.size) log(`정산 미표시 사유: ${[...reasons].map(([k, v]) => `${k} ${v}건`).join(", ")}`);
  for (const [key, m] of Object.entries(names)) log(`${key}: ${m.size ? [...m].map(([k, v]) => `${k}(${v})`).join(", ") : "없음"}`);
  const sample = orders.find((o) => o.settle?.total);
  if (sample) {
    log("정산이 채워진 주문 1건:");
    console.log(JSON.stringify({ order: { ...sample.order, items: undefined }, settle: sample.settle }, null, 1));
  }
}

await ctx.close().catch(() => {});
log("완료. 배민 창을 닫았습니다.");
process.exit(0);
