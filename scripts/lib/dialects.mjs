// scripts/lib/dialects.mjs — Markdown 方言的配置解析与实例化。
//
// build.mjs 与 check.mjs 共用同一份 book.yml → 方言配置的归一化与校验
// （错误以字符串数组返回，check 收集、build 打印后退出，两边报文一致）。
// 渲染期能力（markdown-it 规则、笔记嵌入、客户端脚本、运行时资产）由
// 方言实例提供；build.mjs 只调用这里暴露的通用接口，不再感知具体方言。

import fs from "node:fs";
import path from "node:path";

import { createObsidianDialect, createObsidianVault } from "./obsidian.mjs";

export const SUPPORTED_DIALECTS = Object.freeze(["standard", "obsidian"]);

// book.markdown → { dialect, enabled, allowRawHtml, propertiesMode, vaultRoot, errors[] }
// errors 非空时其余字段不可信；报文不带 configName 前缀，由调用方决定包装。
export function resolveDialectConfig(book, baseDir) {
  const errors = [];
  const markdownRaw = book?.markdown;

  if (
    markdownRaw !== undefined &&
    (!markdownRaw || typeof markdownRaw !== "object" || Array.isArray(markdownRaw))
  ) {
    errors.push('"markdown" must be a mapping.');
  }
  const markdownCfg =
    markdownRaw && typeof markdownRaw === "object" && !Array.isArray(markdownRaw)
      ? markdownRaw
      : {};
  for (const key of Object.keys(markdownCfg)) {
    if (!["dialect", "obsidian"].includes(key)) {
      errors.push(`markdown.${key}: unknown key (use dialect / obsidian).`);
    }
  }

  const dialect = String(markdownCfg.dialect ?? "standard").toLowerCase();
  if (!SUPPORTED_DIALECTS.includes(dialect)) {
    errors.push('markdown.dialect must be "standard" or "obsidian".');
  }
  const enabled = dialect === "obsidian";

  let propertiesMode = "visible";
  let vaultRoot = null;

  if (enabled) {
    const obsidianCfg = markdownCfg.obsidian ?? {};
    if (!obsidianCfg || typeof obsidianCfg !== "object" || Array.isArray(obsidianCfg)) {
      errors.push("markdown.obsidian must be a mapping.");
    } else {
      for (const key of Object.keys(obsidianCfg)) {
        if (!["vault_root", "properties"].includes(key)) {
          errors.push(
            `markdown.obsidian.${key}: unknown key (use vault_root / properties).`
          );
        }
      }
      propertiesMode = String(obsidianCfg.properties ?? "visible").toLowerCase();
      if (!["visible", "hidden", "source"].includes(propertiesMode)) {
        errors.push('markdown.obsidian.properties must be "visible", "hidden", or "source".');
      }
      if (obsidianCfg.vault_root !== undefined && typeof obsidianCfg.vault_root !== "string") {
        errors.push("markdown.obsidian.vault_root must be a directory path string.");
      } else {
        const resolved = path.resolve(baseDir, String(obsidianCfg.vault_root ?? "."));
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          errors.push(
            `markdown.obsidian.vault_root is not a directory: ${obsidianCfg.vault_root ?? "."}`
          );
        } else {
          vaultRoot = resolved;
        }
      }
    }
  }

  return {
    dialect,
    enabled,
    // Obsidian Flavored Markdown follows CommonMark and permits raw HTML.
    // The dialect is opt-in because chapter Markdown is trusted in this mode.
    allowRawHtml: enabled,
    propertiesMode,
    vaultRoot,
    errors
  };
}

// vault 文件索引：一次扫描，build 的各主题渲染与 check 的引用校验共用
export function createDialectVault(cfg) {
  if (!cfg.enabled || !cfg.vaultRoot) return null;
  return createObsidianVault(cfg.vaultRoot);
}

// 每主题一个方言实例（slug / 引用状态隔离）
export function instantiateDialect(cfg, { baseDir, vaultIndex, escapeHtml, slugify }) {
  if (!cfg.enabled) return null;
  return createObsidianDialect({
    baseDir,
    vaultRoot: cfg.vaultRoot,
    vaultIndex,
    propertiesMode: cfg.propertiesMode,
    escapeHtml,
    slugify
  });
}

// 方言需要的客户端脚本（内联进 document.html 的 {{scripts}} 槽）。
// Mermaid 离线转换为 SVG；渲染完成的 promise 供 PDF 管线等待分页。
export function dialectClientScripts(dialect) {
  if (!dialect?.usesMermaid) return "";
  return (
    '<script src="./assets/mermaid.min.js"></script>\n' +
    "<script>\n" +
    '  mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "neutral" });\n' +
    '  window.__MHB_RENDER_READY__ = mermaid.run({ querySelector: ".mermaid" });\n' +
    "</script>"
  );
}

// 方言需要的运行时资产（随 dist/ 分发）。require 由调用方传入，
// 保证从工具自身的依赖树解析。
export function copyDialectRuntimeAssets(builds, distDir, require) {
  if (!builds.some((dialect) => dialect?.usesMermaid)) return;
  const mermaidPath = require.resolve("mermaid/dist/mermaid.min.js");
  const mermaidLicensePath = path.join(
    path.dirname(require.resolve("mermaid/package.json")),
    "LICENSE"
  );
  fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
  fs.copyFileSync(mermaidPath, path.join(distDir, "assets", "mermaid.min.js"));
  if (fs.existsSync(mermaidLicensePath)) {
    fs.copyFileSync(mermaidLicensePath, path.join(distDir, "assets", "mermaid.LICENSE"));
  }
}
