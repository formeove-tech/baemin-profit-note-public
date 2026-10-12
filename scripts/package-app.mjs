// 다른 사장님 PC에 드릴 꾸러미를 만든다 (Windows).
// 사용: npm run package
// 결과: dist/배달이익노트/  와  dist/배달이익노트.zip
//
// 사장님은 압축을 풀고 '배달이익노트 시작.bat' 을 더블클릭하면 된다.
// Node.js 설치는 필요 없다 (node.exe 를 같이 넣는다). 크롬은 각자 PC의 것을 쓴다.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, log } from "./lib/browser.mjs";

const OUT_NAME = "배달이익노트";
const dist = path.join(ROOT, "dist");
// 사장님이 예전 꾸러미를 켜 둔 채로 다시 만들 수 있게, 실행 중인 폴더는 건드리지 않고 임시 폴더에 담는다
const app = path.join(dist, "_build");

function copyDir(from, to, filter = () => true) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!filter(src)) continue;
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else fs.copyFileSync(src, dst);
  }
}

// 1) 빌드
log("앱을 빌드합니다…");
// 개발 서버(npm run dev)가 쓰는 .next 와 겹치면 켜 둔 개발 화면이 깨지므로 (v6에서 실제로 겪음) 따로 빌드한다
const BUILD_DIR = ".next-package";
// .cmd 파일은 Windows 에서 바로 실행되지 않으므로 next 를 node 로 직접 부른다
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "build"], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, NEXT_DIST_DIR: BUILD_DIR },
});

// 2) 꾸러미 폴더 만들기
try {
  fs.rmSync(app, { recursive: true, force: true });
} catch {
  log("이전 꾸러미 폴더를 비울 수 없습니다. 켜 둔 배달이익노트 창(검은 창)을 닫고 다시 실행해 주세요.");
  process.exit(1);
}
fs.mkdirSync(app, { recursive: true });

log("파일을 모읍니다…");
// data 폴더(실제 매출·배민 로그인 프로필)는 어떤 경우에도 꾸러미에 넣지 않는다.
// 맨 위 폴더만 본다 (node_modules/next/dist 같은 안쪽 폴더는 그대로 복사해야 한다)
const standaloneRoot = path.join(ROOT, BUILD_DIR, "standalone");
const notMyData = (p) => {
  const top = path.relative(standaloneRoot, p).split(path.sep)[0];
  return top !== "data" && top !== "dist";
};
copyDir(standaloneRoot, app, notMyData);
copyDir(path.join(ROOT, BUILD_DIR, "static"), path.join(app, BUILD_DIR, "static"));
copyDir(path.join(ROOT, "public"), path.join(app, "public"));
// 수집 스크립트와 그 준비물
// 꾸러미에는 실제로 쓰는 스크립트만 넣는다 (개발용 탐색·진단 도구 제외)
copyDir(path.join(ROOT, "scripts"), path.join(app, "scripts"), (p) => !/package-app\.mjs$|probe-|debug-|export-public/.test(p));
copyDir(path.join(ROOT, "node_modules", "playwright-core"), path.join(app, "node_modules", "playwright-core"));

// 3) Node 실행 파일 같이 넣기 (사장님 PC에 Node 설치가 필요 없도록)
const nodeDir = path.dirname(process.execPath);
fs.mkdirSync(path.join(app, "node"), { recursive: true });
fs.copyFileSync(process.execPath, path.join(app, "node", "node.exe"));
for (const f of ["LICENSE", "LICENSE.md"]) {
  const src = path.join(nodeDir, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(app, "node", "NODE_LICENSE.txt"));
}

// 4) 시작 파일 (한글 파일명은 일부 PC에서 깨져서 실행이 안 되므로 ASCII 로 만든다)
// 서버가 준비된 뒤에 창을 열고, 압축 안 풂·자리 겹침을 알아서 처리하는 launch.mjs 를 실행한다
const bat = [
  "@echo off",
  "chcp 65001 > nul",
  "title 배달이익노트",
  "cd /d \"%~dp0\"",
  "if not exist \"node\\node.exe\" (",
  "  echo.",
  "  echo  [안내] 압축 파일을 먼저 풀어 주세요.",
  "  echo  zip 파일을 마우스 오른쪽 버튼으로 누르고 '모두 압축 풀기'를 한 뒤,",
  "  echo  풀린 폴더 안의 baemin-profit-note-start.bat 을 더블클릭하세요.",
  "  echo.",
  "  pause",
  "  exit /b 1",
  ")",
  "node\\node.exe scripts\\launch.mjs",
  "echo.",
  "pause",
].join("\r\n");
fs.writeFileSync(path.join(app, "baemin-profit-note-start.bat"), bat, "utf8");

const readme = [
  "배달이익노트 — 배민 주문이 실제로 얼마나 남는지 계산하는 프로그램",
  "",
  "■ 켜는 방법",
  "0. 받은 zip 파일은 꼭 먼저 압축을 풀어 주세요 (마우스 오른쪽 → 모두 압축 풀기).",
  "   zip 안에서 바로 더블클릭하면 켜지지 않습니다.",
  "1. 풀린 폴더의 baemin-profit-note-start.bat 을 더블클릭하세요.",
  "   'Windows의 PC 보호' 창이 뜨면 → 추가 정보 → 실행 을 누르세요.",
  "2. 검은 창이 뜨고, 준비가 끝나면 인터넷 창이 저절로 열립니다 (처음엔 10~30초).",
  "   검은 창은 끄지 마세요. 다 쓰셨으면 검은 창을 닫으면 꺼집니다.",
  "",
  "■ 처음 할 일",
  "1. 화면 위쪽 '자료 가져오기' 버튼을 누르세요.",
  "2. 크롬 창이 열리면 배민 사장님 사이트에 직접 로그인하세요.",
  "   (비밀번호는 배민 화면에만 입력되고 이 프로그램은 저장하지 않습니다)",
  "3. 로그인하면 주문·정산·광고 자료를 알아서 읽어 옵니다. 30일치는 5~10분쯤 걸려요.",
  "4. 끝나면 '전체 재료원가율'(예: 35) 을 넣으세요. 그래야 남는 금액이 계산됩니다.",
  "5. 포장비, 인건비·월세 중 배민 몫도 넣으면 더 정확해집니다.",
  "",
  "■ 알아 두실 점",
  "- 모든 자료는 이 PC의 data 폴더에만 저장됩니다. 인터넷으로 어디에도 보내지 않습니다.",
  "- 크롬이 설치돼 있어야 합니다 (없으면 엣지를 씁니다).",
  "- 배민 메뉴·가격·광고 설정을 바꾸지 않습니다. 읽기만 합니다.",
  "- 자료를 새로 받고 싶으면 '자료 가져오기'를 다시 누르면 됩니다.",
  "",
  "■ 잘 안 될 때",
  "- 검은 창에 빨간 글씨가 보이면 그 내용을 알려 주세요.",
  "- '사이트에 연결할 수 없음'이 보이면 10초 뒤 새로고침을 눌러 보세요.",
  "- 검은 창에 [오류] 또는 [안내]가 보이면 그 화면을 사진으로 찍어 보내 주세요.",
].join("\r\n");
fs.writeFileSync(path.join(app, "읽어주세요.txt"), readme, "utf8");

// 5) 마지막 확인 — 내 자료가 한 조각이라도 들어갔으면 만들지 않는다
fs.rmSync(path.join(app, "data"), { recursive: true, force: true });
// 빌드가 남기는 추적 기록(*.nft.json)에는 내 컴퓨터의 수집 파일 이름(가게 번호가 든 것)이 들어갈 수 있다. 실행에는 필요 없으니 지운다.
(function dropTraces(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dropTraces(p);
    else if (e.name.endsWith(".nft.json")) fs.rmSync(p, { force: true });
  }
})(app);
const leaked = [];
// 내 컴퓨터에만 있는 금지어 목록(data/forbidden-names.txt, git 제외)이 있으면 꾸러미 안 글자 파일에서 찾아 본다
try {
  const list = fs.readFileSync(path.join(ROOT, "data", "forbidden-names.txt"), "utf8").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const TEXT = /\.(js|mjs|cjs|json|html|css|txt|bat|md|map)$/i;
  (function grep(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) grep(p);
      else if (TEXT.test(e.name)) {
        const t = fs.readFileSync(p, "utf8");
        for (const w of list) if (t.includes(w)) leaked.push(`${path.relative(app, p)} (금지어 포함)`);
      }
    }
  })(app);
} catch {
  /* 금지어 목록이 없으면 이 검사는 건너뛴다 */
}
const DATA_FILE = /^(store-data\.json|settings\.json|orders-.*\.json|settlements-.*\.json|ads-.*\.json)$/;
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // 배민 로그인 프로필이나 수집 자료 폴더가 통째로 들어간 경우
      if (e.name === "browser-profiles" || (e.name === "data" && fs.existsSync(path.join(p, "collect")))) leaked.push(path.relative(app, p));
      else scan(p);
    } else if (DATA_FILE.test(e.name)) {
      leaked.push(path.relative(app, p));
    }
  }
})(app);
if (leaked.length) {
  log(`중단: 내 매장 자료가 꾸러미에 들어갔습니다 → ${leaked.slice(0, 5).join(", ")}`);
  process.exit(1);
}
log("확인: 내 매장 자료·로그인 정보는 들어 있지 않습니다.");

// 6) 압축
const zip = path.join(dist, `${OUT_NAME}.zip`);
fs.rmSync(zip, { force: true });
log("압축하는 중…");
// Compress-Archive 는 파일을 빠뜨리는 경우가 있어 .NET 압축을 직접 쓴다
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${app}','${zip}')`,
  ],
  { stdio: "inherit" },
);

// 압축에 빠진 파일이 없는지 확인한다
const countFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1), 0);
const expected = countFiles(app);
const inZip = Number(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${zip}'); @($z.Entries | Where-Object { $_.Name -ne '' }).Count; $z.Dispose()`,
    ],
    { encoding: "utf8" },
  ).trim(),
);
if (inZip < expected) {
  log(`중단: 압축에 파일이 빠졌습니다 (폴더 ${expected}개 / 압축 ${inZip}개)`);
  process.exit(1);
}
log(`압축 확인: 파일 ${inZip}개`);

const size = (fs.statSync(zip).size / 1024 / 1024).toFixed(1);
log(`완성: ${path.relative(ROOT, zip)} (${size} MB)`);
log("이 zip 파일을 사장님들께 전달하시면 됩니다.");
