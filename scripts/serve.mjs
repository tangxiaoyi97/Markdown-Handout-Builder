#!/usr/bin/env node
/**
 * scripts/serve.mjs
 *
 * 本地预览：npm run serve [-- --port 8000] [-- --config book.yml]
 *
 *   1. 启动时先构建一次；
 *   2. 监听 notes/、templates/ 和 book.yml，改动后自动重新构建；
 *   3. 起一个零依赖的静态服务器托管 dist/；
 *   4. 服务器给 HTML 注入一小段轮询脚本，重建完成后浏览器自动刷新。
 *
 * 说明：watch 只重建 HTML（快）。PDF 不会自动重新生成——
 * 需要时手动运行 npm run pdf，"下载官方 PDF" 按钮才会指向最新文件。
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const buildScript = path.join(scriptDir, "build.mjs");

/* ---------- 参数 ---------- */

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const configArg = argValue("--config");
const configPath = configArg
  ? path.resolve(process.cwd(), configArg)
  : path.resolve(process.cwd(), "book.yml");
const baseDir = path.dirname(configPath);
const port = Number(argValue("--port") ?? 8000);

if (!fs.existsSync(configPath)) {
  console.error(`Error: config file not found: ${configPath}`);
  process.exit(1);
}

let book = {};
try {
  book = YAML.parse(fs.readFileSync(configPath, "utf8")) ?? {};
} catch (err) {
  console.error(`Error: failed to parse ${path.basename(configPath)}: ${err.message}`);
  process.exit(1);
}

const distDir = path.dirname(path.resolve(baseDir, book.output?.html ?? "dist/handout.html"));
const notesDir = path.join(baseDir, "notes");
const userTemplatesDir = path.join(baseDir, "templates");

/* ---------- 构建（每次 spawn 新进程，保证构建状态干净） ---------- */

let version = 0;
let building = false;
let dirty = false;

function rebuild(reason) {
  if (building) {
    dirty = true;
    return;
  }
  building = true;
  console.log(`[serve] building (${reason}) ...`);

  const args = [buildScript];
  if (configArg) args.push("--config", configPath);

  const child = spawn(process.execPath, args, { stdio: "inherit" });
  child.on("error", (err) => {
    building = false;
    console.error(`[serve] failed to start build process: ${err.message}`);
  });
  child.on("exit", (code) => {
    building = false;
    if (code === 0) {
      version += 1;
      console.log(`[serve] build ok — browser will reload (v${version})`);
    } else {
      console.error("[serve] build failed — fix the error and save again");
    }
    if (dirty) {
      dirty = false;
      rebuild("queued change");
    }
  });
}

/* ---------- 文件监听 ---------- */

let debounceTimer = null;
function onChange(what) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => rebuild(what), 200);
}

function watchDir(dir, label) {
  if (!fs.existsSync(dir)) return;
  try {
    fs.watch(dir, { recursive: true }, (_event, filename) =>
      onChange(`${label}/${filename ?? ""}`)
    );
  } catch {
    // 极老平台不支持 recursive：退化为只监听顶层
    fs.watch(dir, (_event, filename) => onChange(`${label}/${filename ?? ""}`));
    console.warn(`[serve] recursive watch unavailable for ${label}; watching top level only`);
  }
}

watchDir(notesDir, "notes");
watchDir(userTemplatesDir, "templates");
// 监听 book.yml（监听所在目录，避免编辑器"替换文件"导致 watcher 失效）
fs.watch(baseDir, (_event, filename) => {
  if (filename === path.basename(configPath)) onChange(path.basename(configPath));
});

/* ---------- 静态服务器 + 热刷新 ---------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

const RELOAD_SNIPPET =
  "<script>(function(){let v=null;setInterval(async()=>{try{" +
  'const r=await fetch("/__hb_version");const j=await r.json();' +
  "if(v===null)v=j.v;else if(j.v!==v)location.reload();}catch{}},1000);})();</script>";

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("400 Bad Request: malformed URL");
    return;
  }

  if (pathname === "/__hb_version") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ v: version }));
    return;
  }

  const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(distDir, relPath));

  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`404 Not Found: ${pathname}\n(run "npm run build" / "npm run pdf" first?)`);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  let body = fs.readFileSync(filePath);

  if (ext === ".html") {
    // 注入热刷新脚本（只在预览时注入，不改动 dist 里的文件本身）
    body = Buffer.from(body.toString("utf8").replace("</body>", `${RELOAD_SNIPPET}</body>`));
  }

  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Error: port ${port} is in use. Try: npm run serve -- --port 8001`);
    process.exit(1);
  }
  throw err;
});

rebuild("initial");

server.listen(port, () => {
  console.log("");
  console.log(`[serve] http://localhost:${port}/            （首页）`);
  console.log(`[serve] http://localhost:${port}/handout.html（讲义）`);
  console.log("[serve] watching: notes/, templates/, book.yml — 保存后自动重建并刷新浏览器");
  console.log('[serve] 提示：PDF 不会自动重建，需要时另行运行 "npm run pdf"');
  console.log("");
});
