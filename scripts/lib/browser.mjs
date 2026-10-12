// 사용자의 실제 크롬으로 배민 사장님 사이트를 여는 공통 헬퍼.
// 비밀번호·인증번호는 사장님이 배민 화면에 직접 입력하며, 이 코드는 저장하지 않는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function log(...args) {
  const t = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  console.log(`[${t}]`, ...args);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 전용 프로필로 크롬(없으면 엣지)을 띄운다. 로그인 상태는 이 프로필에만 남는다. */
export async function openBrowser(profileName = "baemin") {
  const dir = path.join(ROOT, "data", "browser-profiles", profileName);
  fs.mkdirSync(dir, { recursive: true });
  const opts = {
    headless: false,
    viewport: { width: 1360, height: 940 },
    args: ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"],
    ignoreDefaultArgs: ["--enable-automation"],
    locale: "ko-KR",
  };
  for (const channel of ["chrome", "msedge"]) {
    try {
      const ctx = await chromium.launchPersistentContext(dir, { ...opts, channel });
      log(`브라우저 실행 (${channel})`);
      return ctx;
    } catch (e) {
      log(`${channel} 실행 실패: ${e.message.split("\n")[0]}`);
    }
  }
  throw new Error("크롬 또는 엣지를 찾지 못했습니다. 크롬을 설치해 주세요.");
}

/** 조건이 참이 될 때까지 기다린다 (사장님이 직접 로그인하는 동안 대기) */
export async function waitForPage(page, predicate, { timeoutMs = 10 * 60 * 1000, message = "", every = 1500 } = {}) {
  const started = Date.now();
  let lastMsg = 0;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await page.evaluate(predicate)) return true;
    } catch {
      /* 페이지 이동 중 */
    }
    if (message && Date.now() - lastMsg > 15000) {
      log(message);
      lastMsg = Date.now();
    }
    await sleep(every);
  }
  return false;
}

export function dataDir(...parts) {
  const dir = path.join(ROOT, "data", ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
