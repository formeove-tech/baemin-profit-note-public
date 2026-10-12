// 가게통계 화면에서 월별 광고비·마케팅 비용과 주문 요약을 수집한다.
// 사용: MSYS_NO_PATHCONV=1 node scripts/collect-ads.mjs --months 2026-08,2026-09 [--shop 가게번호]
//
// 화면이 보내는 통계 요청의 '조회 월'만 바꿔 다시 부르고 그 응답을 받아 적는다. 설정은 바꾸지 않는다.

import fs from "node:fs";
import path from "node:path";
import { dataDir, log, openBrowser, sleep, waitForPage } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
const arg = (n, d = "") => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : d);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const months = (arg("months") || today.slice(0, 7)).split(",").map((m) => m.trim());

const ctx = await openBrowser("baemin");
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto("https://self.baemin.com/", { waitUntil: "domcontentloaded" }).catch(() => {});
if (!/self\.baemin\.com/.test(page.url())) {
  log("배민 로그인이 필요합니다. 열린 크롬 창에서 직접 로그인해 주세요.");
  await waitForPage(page, () => location.host === "self.baemin.com", { message: "로그인을 기다리는 중…" });
}

// 가게 번호 확인 (지정하지 않으면 화면의 링크에서 읽는다)
let shop = arg("shop");
if (!shop) {
  await sleep(4000);
  shop = await page.evaluate(() => (document.body.innerHTML.match(/\/shops\/(\d{5,})\//) ?? [])[1] ?? "");
}
if (!shop) {
  log("가게 번호를 찾지 못했습니다. --shop 번호 를 붙여 실행해 주세요.");
  await ctx.close().catch(() => {});
  process.exit(1);
}
log(`가게 ${shop}, 조회 월: ${months.join(", ")}`);

let month = months[0];
await page.route("**/v3/statistics/**", async (route) => {
  const url = new URL(route.request().url());
  if (url.searchParams.has("month")) url.searchParams.set("month", month);
  await route.continue({ url: url.toString() });
});

const result = {};
for (const m of months) {
  month = m;
  const captured = {};
  const onResponse = async (res) => {
    const u = res.url();
    if (!u.includes("/v3/statistics/")) return;
    try {
      const body = await res.json();
      if (u.includes("orders/summary")) captured.orders = body;
      else if (u.includes("order-costs")) (captured.costs ??= []).push(...(Array.isArray(body) ? body : []));
      else if (u.includes("new-reorder")) captured.newReorder = body;
    } catch {
      /* 무시 */
    }
  };
  page.on("response", onResponse);
  await page.goto(`https://self.baemin.com/shops/${shop}/stat`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await sleep(12_000);
  page.off("response", onResponse);

  const byGroup = Object.fromEntries((captured.costs ?? []).map((c) => [c.group, c]));
  result[m] = {
    orderAmount: captured.orders?.orderAmount ?? null,
    orderCount: captured.orders?.orderCount ?? null,
    daily: captured.orders?.graph?.data ?? [],
    groups: byGroup,
  };
  const cpc = byGroup.CPC;
  log(
    `${m}: 주문 ${captured.orders?.orderCount ?? "?"}건 · 주문금액 ${(captured.orders?.orderAmount ?? 0).toLocaleString("ko-KR")}원` +
      (cpc ? ` · 우리가게클릭 ${Number(cpc.cost ?? 0).toLocaleString("ko-KR")}원 (연결 주문 ${cpc.orderCount}건, 매출 ${Number(cpc.orderAmount ?? 0).toLocaleString("ko-KR")}원)` : " · 광고비 없음"),
  );
  for (const [g, v] of Object.entries(byGroup)) {
    if (g === "CPC" || v.cost === null || v.cost === 0) continue;
    log(`   ${g}: 비용 ${Number(v.cost).toLocaleString("ko-KR")}원 · 주문 ${v.orderCount}건`);
  }
}

const outDir = dataDir("collect");
const file = path.join(outDir, `ads-${months[0]}_${months[months.length - 1]}.json`);
fs.writeFileSync(file, JSON.stringify({ shop, collectedAt: new Date().toISOString(), months: result }, null, 1), "utf8");
log(`저장: ${path.relative(process.cwd(), file)}`);

await ctx.close().catch(() => {});
process.exit(0);
