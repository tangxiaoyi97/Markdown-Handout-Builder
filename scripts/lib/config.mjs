// scripts/lib/config.mjs — book.yml 的加载与归一化，build / check / render-pdf 共用。
// 单一事实源：三个入口脚本此前各自复制这一层，主题合并规则曾经三处漂移。
//
// 错误处理沿用现有 CLI 约定：加载失败打印 Error 并 exit(1)（三个调用方
// 行为一致）。库化的 throw/collect 改造见 CHANGELOG 的后续计划。

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

// --config <file> 参数 → 配置文件绝对路径（默认 ./book.yml）
export function resolveConfigPath(argv = process.argv) {
  const i = argv.indexOf("--config");
  if (i !== -1) {
    const value = argv[i + 1];
    if (!value) {
      console.error("Error: --config requires a file path, e.g. --config book.yml");
      process.exit(1);
    }
    return path.resolve(process.cwd(), value);
  }
  return path.resolve(process.cwd(), "book.yml");
}

// 存在性 / YAML 解析 / 顶层必须是映射，三项都过才返回配置对象
export function loadBook(configPath) {
  const configName = path.basename(configPath);
  if (!fs.existsSync(configPath)) {
    console.error(`Error: config file not found: ${configPath}`);
    process.exit(1);
  }
  let book;
  try {
    book = YAML.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error(`Error: failed to parse ${configName}: ${err.message}`);
    process.exit(1);
  }
  if (!book || typeof book !== "object" || Array.isArray(book)) {
    console.error(`Error: ${configName} is empty or not a YAML mapping.`);
    process.exit(1);
  }
  return book;
}

// 多主题：默认单主题（空 name = 使用标准文件名）
export function normalizeThemes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { name: "", label: "", isDefault: true, style: {}, cover: {}, back_cover: {}, pdf: {} }
    ];
  }
  let defaultIndex = raw.findIndex((t) => t && t.default === true);
  if (defaultIndex === -1) defaultIndex = 0;
  return raw.map((t, i) => {
    const name = String(t?.name ?? `theme${i + 1}`);
    // 主题名进入输出文件名，必须安全（check 也会校验，这里兜底）
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) {
      console.error(
        `Error: invalid theme name ${JSON.stringify(name)} — ` +
          `must match [A-Za-z0-9][A-Za-z0-9_-]* (it is used in output filenames).`
      );
      process.exit(1);
    }
    return {
      name,
      label: String(t?.label ?? t?.name ?? `theme${i + 1}`),
      isDefault: i === defaultIndex,
      style: t?.style ?? {},
      cover: t?.cover ?? {},
      back_cover: t?.back_cover ?? {},
      pdf: t?.pdf ?? {}
    };
  });
}

// 非默认主题的产物：basename 加 .<name> 后缀（同目录，assets 共享）
export function variantPath(basePath, theme) {
  if (theme.isDefault) return basePath;
  const ext = path.extname(basePath);
  return path.join(
    path.dirname(basePath),
    `${path.basename(basePath, ext)}.${theme.name}${ext}`
  );
}

// pdf 配置合并：header / footer / page_numbers / header_footer_style
// 为嵌套对象，主题只写其中一个键时不应丢掉基础配置的其余键
export function mergePdfCfg(base, override) {
  const merged = { ...(base ?? {}), ...(override ?? {}) };
  for (const key of ["page_numbers", "header", "footer", "header_footer_style"]) {
    if (base?.[key] || override?.[key]) {
      merged[key] = { ...(base?.[key] ?? {}), ...(override?.[key] ?? {}) };
    }
  }
  return merged;
}
