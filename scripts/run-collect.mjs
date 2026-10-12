// 수집 전체를 순서대로 실행한다 (앱의 '자료 가져오기' 버튼이 이 스크립트를 부른다).
// 사용: node scripts/run-collect.mjs --start 2026-08-19 --end 2026-09-17 [--skip-settlements]
//
// 1) 주문·정산 상세가 들어 있는 주문내역  2) 월별 광고·마케팅 비용  3) 정산명세서  4) 변환
// 한 번에 하나씩 실행한다. 크롬 창은 한 번만 뜨고, 사장님은 로그인만 하면 된다.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./lib/browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d = "") => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : d);

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const START = arg("start", addDays(today, -30));
const END = arg("end", addDays(today, -1));

/** 정산 입금일은 주문일보다 며칠 뒤라 조금 넉넉히 본다 */
const SETTLE_START = addDays(START, 1);
const SETTLE_END = addDays(END, 7);

const months = [];
for (let d = START.slice(0, 7); d <= END.slice(0, 7); ) {
  months.push(d);
  const [y, m] = d.split("-").map(Number);
  d = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

let step = 0;
const TOTAL_STEPS = argv.includes("--skip-settlements") ? 3 : 4;

function run(script, args, label) {
  return new Promise((resolve) => {
    log(`▶ [${++step}/${TOTAL_STEPS}] ${label}`);
    const child = spawn(process.execPath, [path.join(HERE, script), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const forward = (buf) => process.stdout.write(buf);
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("close", (code) => {
      if (code === 0) log(`✔ [${step}/${TOTAL_STEPS}] ${label} 완료`);
      else log(`✖ ${label} 실패 (코드 ${code}) — 여기까지 받은 자료로 계속합니다`);
      resolve(code);
    });
  });
}

log(`자료 가져오기 시작: ${START} ~ ${END}`);
await run("collect-baemin.mjs", ["--start", START, "--end", END], "주문·정산 내역");
await run("collect-ads.mjs", ["--months", months.join(",")], "광고·마케팅 비용");
if (!argv.includes("--skip-settlements")) {
  await run("collect-settlements.mjs", ["--start", SETTLE_START, "--end", SETTLE_END], "정산명세서");
}
await run("normalize-baemin.mjs", [], "자료 정리");
log("모두 끝났습니다. 화면에서 결과를 확인하세요.");
process.exit(0);
