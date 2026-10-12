// 정산내역 화면에서 정산 건별 명세서(공제 상세·광고비)를 수집한다.
// 사용: MSYS_NO_PATHCONV=1 node scripts/collect-settlements.mjs --start 2026-08-19 --end 2026-09-21
//   기간은 '입금일' 기준이다 (주문일보다 며칠 뒤에 입금된다).
//
// 화면이 보내는 조회 요청의 조건만 바꿔 다시 부르고 그 응답을 받아 적는다. 설정은 바꾸지 않는다.

import fs from "node:fs";
import path from "node:path";
import { dataDir, log, openBrowser, sleep, waitForPage } from "./lib/browser.mjs";

const argv = process.argv.slice(2);
const arg = (n, d = "") => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : d);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const START = arg("start", addDays(today, -35));
const END = arg("end", addDays(today, 7)); // 입금 예정분까지

const BILLING = "https://self.baemin.com/orders/billing";

const ctx = await openBrowser("baemin");
const page = ctx.pages()[0] ?? (await ctx.newPage());

let wantDetailId = null;
let wantPage = 0; // 정산 목록은 한 번에 10건까지만 조회된다
await page.route("**/v3/settle/history/summary**", async (route) => {
  const url = new URL(route.request().url());
  url.searchParams.set("startDate", START);
  url.searchParams.set("endDate", END);
  url.searchParams.set("size", "10");
  url.searchParams.set("page", String(wantPage));
  await route.continue({ url: url.toString() });
});
await page.route("**/v3/settle/history/details/**", async (route) => {
  if (!wantDetailId) return route.continue();
  const url = route.request().url().replace(/details\/\d+/, `details/${wantDetailId}`);
  await route.continue({ url });
});

await page.goto(BILLING, { waitUntil: "domcontentloaded" }).catch(() => {});
if (!/self\.baemin\.com/.test(page.url())) {
  log("배민 로그인이 필요합니다. 열린 크롬 창에서 직접 로그인해 주세요.");
  await waitForPage(page, () => location.host === "self.baemin.com", { message: "로그인을 기다리는 중…" });
  await page.goto(BILLING, { waitUntil: "domcontentloaded" }).catch(() => {});
}

/** 화면을 다시 불러 정산 목록 한 쪽을 받는다 (가끔 화면이 늦게 떠서 몇 번 다시 시도한다) */
async function loadList(pageNo = 0, tries = 3) {
  wantPage = pageNo;
  for (let i = 1; i <= tries; i++) {
    try {
      const waiting = page.waitForResponse((r) => r.url().includes("/v3/settle/history/summary"), { timeout: 45_000 });
      await page.goto(BILLING, { waitUntil: "domcontentloaded" }).catch(() => {});
      const res = await waiting;
      if (res.status() !== 200) {
        log(`정산 목록 조회 실패 (상태 ${res.status()}): ${(await res.text()).slice(0, 200)}`);
        return { contents: [] };
      }
      return await res.json();
    } catch (e) {
      log(`정산 목록을 받지 못했습니다 (${i}/${tries}): ${String(e.message).split("\n")[0]}`);
      if (i === tries) return { contents: [] };
      await sleep(3000);
    }
  }
  return { contents: [] };
}

/**
 * 정산 한 건의 명세서를 받는다 (목록의 첫 줄을 눌러 요청이 나가게 하고, 주소만 바꿔치기).
 * 화면이 늦게 뜨면 줄을 못 눌러 실패하므로 몇 번 다시 시도한다.
 */
async function loadDetail(giveId, tries = 3) {
  let lastError = null;
  for (let i = 1; i <= tries; i++) {
    wantDetailId = giveId;
    try {
      const waiting = page.waitForResponse((r) => /\/v3\/settle\/history\/details\//.test(r.url()) && r.status() === 200, { timeout: 45_000 });
      await page.goto(BILLING, { waitUntil: "domcontentloaded" }).catch(() => {});
      // 목록이 그려질 때까지 기다렸다가 누른다 (고정 대기보다 안정적)
      await page
        .waitForFunction(() => /입금요청|입금완료/.test(document.body.innerText || ""), { timeout: 30_000 })
        .catch(() => {});
      const clicked = await page.evaluate(() => {
        const els = [...document.querySelectorAll("button, a, [role=button], li, div")].filter((e) => e.offsetParent !== null);
        const el = els.filter((x) => /입금요청|입금완료/.test(x.innerText || "")).sort((a, b) => (a.innerText || "").length - (b.innerText || "").length)[0];
        if (!el) return false;
        el.scrollIntoView({ block: "center" });
        el.click();
        return true;
      });
      if (!clicked) throw new Error("정산 목록에서 명세서를 열지 못했습니다");
      const body = await waiting.then((r) => r.json());
      wantDetailId = null;
      return body;
    } catch (e) {
      lastError = e;
      wantDetailId = null;
      if (i < tries) await sleep(2500);
    }
  }
  throw lastError ?? new Error("명세서를 받지 못했습니다");
}

log(`정산 조회 기간(입금일 기준) ${START} ~ ${END}`);
const contents = [];
let total = null;
for (let p = 0; p < 40; p++) {
  const list = await loadList(p);
  const chunk = list?.contents ?? [];
  total ??= list?.totalSize ?? null;
  contents.push(...chunk);
  if (chunk.length < 10 || (total !== null && contents.length >= total)) break;
  await sleep(500);
}
wantPage = 0;
log(`정산 ${contents.length}건 (전체 ${total ?? "?"}건)`);

const details = [];
const failed = [];
for (const [i, item] of contents.entries()) {
  try {
    const body = await loadDetail(item.giveId);
    details.push({ summary: item, detail: body });
    const cpc = body?.cpcDetails;
    log(
      `${i + 1}/${contents.length} · 입금일 ${item.depositDueDate} · 정산기간 ${item.giveStartDate}~${item.giveEndDate} · ` +
        `입금 ${Number(item.giveAmount).toLocaleString("ko-KR")}원` +
        (cpc?.total ? ` · 광고 ${Math.abs(cpc.total).toLocaleString("ko-KR")}원` : ""),
    );
  } catch (e) {
    failed.push(item);
    log(`${i + 1}/${contents.length} · ${item.depositDueDate} 정산을 받지 못했습니다: ${String(e.message).split("\n")[0]}`);
  }
  await sleep(500);
}

const file = path.join(dataDir("collect"), `settlements-${START}_${END}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
fs.writeFileSync(file, JSON.stringify({ range: { start: START, end: END }, collectedAt: new Date().toISOString(), details }, null, 1), "utf8");
log(`저장: ${path.relative(process.cwd(), file)} (${details.length}건)`);
if (failed.length) log(`받지 못한 정산 ${failed.length}건: ${failed.map((f) => f.depositDueDate).join(", ")} — 다시 실행하면 이어서 받습니다.`);

await ctx.close().catch(() => {});
process.exit(0);
