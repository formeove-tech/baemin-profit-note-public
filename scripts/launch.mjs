// 배달이익노트 시작 프로그램 (꾸러미의 시작 파일이 이것을 실행한다).
//
// 예전 시작 파일은 서버가 켜지기 전에 인터넷 창을 먼저 열어서,
// 느린 PC에서는 "localhost에서 연결을 거부했습니다"가 떴다. 이제는
//   1) 압축을 제대로 풀었는지 확인하고
//   2) 3500번 자리가 비어 있지 않으면 다음 자리(3501~)를 쓰고
//   3) 서버가 실제로 응답할 때까지 기다린 뒤에
//   4) localhost 대신 127.0.0.1 주소로 창을 연다 (일부 PC의 localhost 문제 회피)

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server.js");
const say = (...a) => console.log(" ", ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) 압축을 풀지 않고 zip 안에서 실행한 경우 (시작 파일만 임시 폴더로 빠져나와 나머지가 없다)
if (!fs.existsSync(SERVER)) {
  say("");
  say("[안내] 프로그램 파일을 찾지 못했습니다.");
  say("압축 파일(zip)을 먼저 풀어 주세요:");
  say("  zip 파일을 마우스 오른쪽 버튼으로 누르고 → '압축 풀기' 또는 '모두 압축 풀기'");
  say("  → 풀린 폴더 안의 baemin-profit-note-start.bat 을 더블클릭하세요.");
  process.exit(1);
}
if (/\\Temp\\/i.test(ROOT) && /\.zip/i.test(ROOT)) {
  say("[안내] zip 파일 안에서 바로 실행한 것 같습니다. 압축을 푼 뒤 실행해야 자료가 저장됩니다.");
}

// 2) 빈 자리 찾기 (예전 프로그램이 켜져 있거나 다른 프로그램이 3500을 쓰는 경우)
function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}
let port = null;
for (let p = 3500; p <= 3520; p++) {
  if (await isFree(p)) {
    port = p;
    break;
  }
}
if (port === null) {
  say("[안내] 3500~3520 자리가 모두 사용 중입니다. 켜 둔 배달이익노트 검은 창을 모두 닫거나 PC를 다시 시작해 주세요.");
  process.exit(1);
}
if (port !== 3500) say(`(3500 자리를 다른 프로그램이 쓰고 있어서 ${port} 자리로 켭니다)`);

const url = `http://127.0.0.1:${port}`;
say("배달이익노트를 켜는 중입니다. 처음에는 10~30초쯤 걸릴 수 있어요.");
say("이 검은 창은 끄지 마세요. 다 쓰시면 이 창을 닫으면 꺼집니다.");
say("");

// 3) 서버 켜기
const child = spawn(process.execPath, [SERVER], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (b) => (serverLog += b.toString()));
child.stderr.on("data", (b) => {
  serverLog += b.toString();
  process.stderr.write(b);
});
child.on("exit", (code) => {
  say("");
  say(code === 0 ? "배달이익노트를 껐습니다." : `[오류] 프로그램이 멈췄습니다 (코드 ${code}). 이 창의 내용을 사진으로 찍어 보내 주세요.`);
  if (code !== 0 && serverLog) console.log(serverLog.split(/\r?\n/).slice(-15).join("\n"));
  process.exit(code ?? 1);
});

// 4) 서버가 실제로 응답할 때까지 기다렸다가 창을 연다 (최대 2분)
let ready = false;
for (let i = 0; i < 240; i++) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.status < 500) {
      ready = true;
      break;
    }
  } catch {
    /* 아직 켜지는 중 */
  }
  if (i === 20) say("아직 켜지는 중입니다… (백신 프로그램이 처음 실행을 검사하면 오래 걸릴 수 있어요)");
  await sleep(500);
}

if (!ready) {
  say(`[안내] 2분이 지나도 켜지지 않았습니다. 인터넷 창에서 직접 ${url} 을 열어 보시고,`);
  say("그래도 안 되면 이 창의 내용을 사진으로 찍어 보내 주세요.");
} else {
  say(`준비됐습니다 → ${url}`);
  if (process.env.BPN_NO_OPEN !== "1") {
    // 기본 인터넷 창으로 연다 (Windows)
    spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
  }
}
