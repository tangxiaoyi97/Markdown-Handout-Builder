import fs from "node:fs";
import path from "node:path";

import YAML from "yaml";

const IMAGE_EXTS = new Set([".avif", ".bmp", ".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const AUDIO_EXTS = new Set([".flac", ".m4a", ".mp3", ".ogg", ".wav", ".webm", ".3gp"]);
const VIDEO_EXTS = new Set([".mkv", ".mov", ".mp4", ".ogv", ".webm"]);
const ACCEPTED_EXTS = new Set([
  ".md", ".base", ".canvas", ".pdf",
  ...IMAGE_EXTS,
  ...AUDIO_EXTS,
  ...VIDEO_EXTS
]);

const SKIP_DIRS = new Set([".git", ".obsidian", "node_modules", "dist"]);
const BLOCK_ID_RE = /(?:^|[ \t])\^([A-Za-z0-9-]+)\s*$/;

const toPosix = (value) => value.split(path.sep).join("/");
const normalizeKey = (value) =>
  String(value ?? "").normalize("NFKC").replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
const normalizeHeading = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/%%[\s\S]*?%%/g, "")
    .replace(/!?(?:\[\[)([^\]]+?)(?:\]\])/g, (_whole, inner) => {
      const pipe = splitUnescaped(inner, "|");
      return (pipe[1] ?? pipe[0]).replace(/^[^#]*#/, "");
    })
    .replace(/[*_~=`]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function splitUnescaped(value, delimiter) {
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === delimiter) {
      return [value.slice(0, i), value.slice(i + 1)];
    }
  }
  return [value];
}

function unescapeWikilinkPart(value) {
  return String(value ?? "").replace(/\\([|#\[\]\\])/g, "$1").trim();
}

// In a Markdown table Obsidian requires `\|` so the table parser does not
// consume the wikilink alias separator. It is still a semantic `|` here.
function splitWikilinkAlias(value) {
  const index = String(value).indexOf("|");
  if (index === -1) return [String(value)];
  const escaped = value[index - 1] === "\\";
  return [value.slice(0, index - (escaped ? 1 : 0)), value.slice(index + 1)];
}

export function parseObsidianReference(raw, { embed = false } = {}) {
  const [targetAndFragment, rawAlias] = splitWikilinkAlias(String(raw ?? ""));
  const hash = targetAndFragment.indexOf("#");
  const target = unescapeWikilinkPart(
    hash === -1 ? targetAndFragment : targetAndFragment.slice(0, hash)
  );
  const fragment = unescapeWikilinkPart(
    hash === -1 ? "" : targetAndFragment.slice(hash + 1)
  );
  const alias = unescapeWikilinkPart(rawAlias ?? "");
  const size = embed ? alias.match(/^(\d+)(?:\s*[xX×]\s*(\d+))?$/) : null;
  return {
    raw: String(raw ?? ""),
    target,
    fragment,
    alias,
    width: size ? Number(size[1]) : null,
    height: size?.[2] ? Number(size[2]) : null,
    embed
  };
}

export function parseObsidianFrontmatter(source) {
  const text = String(source ?? "").replace(/^\uFEFF/, "");
  const match = text.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { body: text, data: {}, raw: "", error: null, lineOffset: 0 };
  const lineOffset = (match[0].match(/\n/g) ?? []).length;

  let data;
  try {
    data = YAML.parse(match[1]);
  } catch (error) {
    return {
      body: text.slice(match[0].length),
      data: {},
      raw: match[1],
      error: error.message,
      lineOffset
    };
  }
  if (data === null || data === undefined) data = {};
  if (typeof data !== "object" || Array.isArray(data)) {
    return {
      body: text.slice(match[0].length),
      data: {},
      raw: match[1],
      error: "properties must be a YAML mapping",
      lineOffset
    };
  }
  return { body: text.slice(match[0].length), data, raw: match[1], error: null, lineOffset };
}

/**
 * Remove Obsidian %% comments while preserving newlines and code spans/fences.
 * Spaces are retained in place of comments so source line numbers remain stable.
 */
export function stripObsidianComments(source) {
  const lines = String(source ?? "").split(/(?<=\n)/);
  let inComment = false;
  let fenceChar = "";
  let fenceLength = 0;
  let codeTicks = 0;

  return lines
    .map((line) => {
      const body = line.endsWith("\n") ? line.slice(0, -1) : line;
      const newline = line.endsWith("\n") ? "\n" : "";
      const fence = body.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (!inComment && fence) {
        const char = fence[1][0];
        if (!fenceChar) {
          fenceChar = char;
          fenceLength = fence[1].length;
        } else if (char === fenceChar && fence[1].length >= fenceLength) {
          fenceChar = "";
          fenceLength = 0;
        }
        return line;
      }
      if (fenceChar) return line;

      let out = "";
      let i = 0;
      while (i < body.length) {
        if (!inComment && body[i] === "`" && body[i - 1] !== "\\") {
          let run = 1;
          while (body[i + run] === "`") run += 1;
          if (codeTicks === 0) codeTicks = run;
          else if (run === codeTicks) codeTicks = 0;
          out += body.slice(i, i + run);
          i += run;
          continue;
        }
        if (codeTicks === 0 && body.slice(i, i + 2) === "%%" && body[i - 1] !== "\\") {
          inComment = !inComment;
          out += "  ";
          i += 2;
          continue;
        }
        out += inComment ? " " : body[i];
        i += 1;
      }
      return out + newline;
    })
    .join("");
}

function walkVault(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
        visit(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

export function createObsidianVault(vaultRoot) {
  const root = path.resolve(vaultRoot);
  const files = [];
  const byRel = new Map();
  const byName = new Map();
  const byAlias = new Map();

  for (const absPath of walkVault(root)) {
    const ext = path.extname(absPath).toLowerCase();
    if (!ACCEPTED_EXTS.has(ext)) continue;
    const relPath = toPosix(path.relative(root, absPath));
    const record = {
      absPath,
      relPath,
      ext,
      name: path.basename(absPath),
      stem: path.basename(absPath, ext),
      properties: {},
      frontmatterError: null
    };

    if (ext === ".md") {
      const frontmatter = parseObsidianFrontmatter(fs.readFileSync(absPath, "utf8"));
      record.properties = frontmatter.data;
      record.frontmatterError = frontmatter.error;
    }

    files.push(record);
    const relKeys = [relPath];
    if (ext === ".md") relKeys.push(relPath.slice(0, -ext.length));
    for (const key of relKeys) byRel.set(normalizeKey(key), record);

    const nameKeys = [record.name];
    if (ext === ".md") nameKeys.push(record.stem);
    for (const key of nameKeys) {
      const normalized = normalizeKey(key);
      const list = byName.get(normalized) ?? [];
      list.push(record);
      byName.set(normalized, list);
    }

    for (const alias of arrayValue(record.properties.aliases)) {
      const key = normalizeKey(alias);
      if (!key) continue;
      const list = byAlias.get(key) ?? [];
      list.push(record);
      byAlias.set(key, list);
    }
  }

  const relativeDir = (fromFile) =>
    toPosix(path.dirname(path.relative(root, fromFile))).replace(/^\.$/, "");
  const directoryDistance = (record, fromFile) => {
    const fromParts = relativeDir(fromFile).split("/").filter(Boolean);
    const toParts = path.posix.dirname(record.relPath).split("/").filter(Boolean);
    let common = 0;
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
      common += 1;
    }
    return fromParts.length + toParts.length - common * 2;
  };

  function resolve(target, fromFile) {
    if (!target) {
      const own = files.find((file) => file.absPath === path.resolve(fromFile));
      return own ? { file: own, ambiguous: [] } : null;
    }

    let decoded = target;
    try {
      decoded = decodeURIComponent(target);
    } catch {
      // Keep the authored value when it is not valid percent encoding.
    }
    decoded = decoded.replace(/\\/g, "/").replace(/^\//, "");

    const fromRelDir = relativeDir(fromFile);
    const candidates = [];
    const exactKeys = [decoded, path.posix.join(fromRelDir, decoded)];
    if (!path.posix.extname(decoded)) {
      exactKeys.push(decoded + ".md", path.posix.join(fromRelDir, decoded + ".md"));
    }
    for (const key of exactKeys) {
      const record = byRel.get(normalizeKey(path.posix.normalize(key)));
      if (record && !candidates.includes(record)) candidates.push(record);
    }
    if (candidates.length === 1) return { file: candidates[0], ambiguous: [] };
    if (candidates.length > 1) {
      const ranked = candidates.sort((a, b) => directoryDistance(a, fromFile) - directoryDistance(b, fromFile));
      return { file: ranked[0], ambiguous: ranked.slice(1) };
    }

    const lookup = normalizeKey(path.posix.basename(decoded));
    const loose = [...(byName.get(lookup) ?? []), ...(byAlias.get(normalizeKey(decoded)) ?? [])]
      .filter((record, index, list) => list.indexOf(record) === index)
      .sort((a, b) => {
        const distance = directoryDistance(a, fromFile) - directoryDistance(b, fromFile);
        return distance || a.relPath.localeCompare(b.relPath);
      });
    if (loose.length === 0) return null;
    const bestDistance = directoryDistance(loose[0], fromFile);
    return {
      file: loose[0],
      ambiguous: loose.slice(1).filter((item) => directoryDistance(item, fromFile) === bestDistance)
    };
  }

  return { root, files, resolve };
}

function scanLineForReferences(line, lineNo, results, inlineState) {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "`" && line[i - 1] !== "\\") {
      let run = 1;
      while (line[i + run] === "`") run += 1;
      if (inlineState.codeTicks === 0) inlineState.codeTicks = run;
      else if (run === inlineState.codeTicks) inlineState.codeTicks = 0;
      i += run - 1;
      continue;
    }
    if (inlineState.codeTicks !== 0) continue;
    const embed = line[i] === "!" && line.slice(i + 1, i + 3) === "[[";
    const link = line.slice(i, i + 2) === "[[";
    if (!embed && !link) continue;
    const start = i + (embed ? 3 : 2);
    const close = line.indexOf("]]", start);
    if (close === -1) continue;
    results.push({
      line: lineNo,
      column: i + 1,
      ...parseObsidianReference(line.slice(start, close), { embed })
    });
    i = close + 1;
  }
}

export function scanObsidianReferences(source, { includeFrontmatter = false } = {}) {
  const frontmatter = parseObsidianFrontmatter(source);
  const clean = stripObsidianComments(includeFrontmatter ? String(source ?? "") : frontmatter.body);
  const lineOffset = includeFrontmatter ? 0 : frontmatter.lineOffset;
  const results = [];
  const inlineState = { codeTicks: 0 };
  let fenceChar = "";
  let fenceLength = 0;
  clean.split(/\r?\n/).forEach((line, index) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const char = fence[1][0];
      if (!fenceChar) {
        fenceChar = char;
        fenceLength = fence[1].length;
      } else if (char === fenceChar && fence[1].length >= fenceLength) {
        fenceChar = "";
        fenceLength = 0;
      }
      return;
    }
    if (!fenceChar) {
      scanLineForReferences(line, index + 1 + lineOffset, results, inlineState);
    }
  });
  return results;
}

function titleCase(value) {
  return String(value)
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function safeClassList(value) {
  return arrayValue(value)
    .flatMap((item) => String(item).trim().split(/\s+/))
    .filter((item) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(item));
}

function encodePathForHtml(relPath) {
  return relPath.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function removeBlockIdFromChildren(children, identifier) {
  const suffix = new RegExp("(?:^|[ \\t])\\^" + identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (children[i].type !== "text") continue;
    children[i].content = children[i].content.replace(suffix, "");
    return;
  }
}

function extractHeadingSection(source, fragment) {
  const wantedParts = fragment.split("#").filter(Boolean).map(normalizeHeading);
  const wanted = wantedParts.at(-1) ?? "";
  const lines = source.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";
  const stack = [];
  let start = -1;
  let startLevel = 7;
  let end = lines.length;

  for (let i = 0; i < lines.length; i += 1) {
    const fence = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence[1][0];
      } else if (fence[1][0] === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;
    const heading = lines[i].match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!heading) continue;
    const level = heading[1].length;
    const normalized = normalizeHeading(heading[2]);
    stack[level - 1] = normalized;
    stack.length = level;
    const hierarchy = stack.filter(Boolean);
    const hierarchyMatches =
      wantedParts.length <= 1 ||
      wantedParts.every((part, index) => hierarchy[hierarchy.length - wantedParts.length + index] === part);

    if (start === -1 && normalized === wanted && hierarchyMatches) {
      start = i;
      startLevel = level;
    } else if (start !== -1 && level <= startLevel) {
      end = i;
      break;
    }
  }
  return start === -1 ? null : lines.slice(start, end).join("\n");
}

function extractBlock(source, identifier) {
  const lines = source.split(/\r?\n/);
  const marker = new RegExp("(?:^|[ \\t])\\^" + identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*$");
  const index = lines.findIndex((line) => marker.test(line));
  if (index === -1) return null;

  if (lines[index].trim() === "^" + identifier) {
    let start = index - 1;
    while (start > 0 && lines[start - 1].trim() !== "") start -= 1;
    return lines.slice(start, index).join("\n");
  }

  let start = index;
  while (start > 0 && lines[start - 1].trim() !== "") start -= 1;
  return lines.slice(start, index + 1).join("\n");
}

export function obsidianFragmentExists(filePath, fragment) {
  if (!fragment) return true;
  const parsed = parseObsidianFrontmatter(fs.readFileSync(filePath, "utf8"));
  const clean = stripObsidianComments(parsed.body);
  return fragment.startsWith("^")
    ? extractBlock(clean, fragment.slice(1)) !== null
    : extractHeadingSection(clean, fragment) !== null;
}

export function createObsidianDialect({
  baseDir,
  vaultRoot = baseDir,
  vaultIndex = null,
  propertiesMode = "visible",
  escapeHtml,
  slugify
}) {
  const vault = vaultIndex ?? createObsidianVault(vaultRoot);
  const htmlEscape = escapeHtml ?? ((value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"));
  const slug = slugify ?? ((value) => normalizeHeading(value).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, ""));
  const referencedFiles = new Set();
  const warnings = new Set();
  const linkPlaceholders = [];
  const noteEmbeds = new Map();
  const noteRecords = new Map();
  let embedSequence = 0;
  let usesMermaid = false;

  const noteRecord = (filePath) => {
    const key = path.resolve(filePath);
    if (!noteRecords.has(key)) {
      noteRecords.set(key, { first: [], headings: new Map(), blocks: new Map() });
    }
    return noteRecords.get(key);
  };

  const warn = (message) => warnings.add(message);

  function prepareSource(source) {
    const frontmatter = parseObsidianFrontmatter(source);
    return {
      source: stripObsidianComments(frontmatter.body),
      properties: frontmatter.data,
      propertiesRaw: frontmatter.raw,
      frontmatterError: frontmatter.error,
      cssClasses: safeClassList(frontmatter.data.cssclasses)
    };
  }

  function resolveReference(spec, fromFile) {
    const result = vault.resolve(spec.target, fromFile);
    if (result?.ambiguous?.length) {
      warn(
        "Ambiguous Obsidian link " + JSON.stringify(spec.target) + " in " +
          toPosix(path.relative(vault.root, fromFile)) + "; using " + result.file.relPath
      );
    }
    return result?.file ?? null;
  }

  function outputHref(file) {
    referencedFiles.add(file.absPath);
    return "vault/" + encodePathForHtml(file.relPath);
  }

  function placeholderForLink(file, spec, fromFile) {
    const placeholder = "__MHB_OBSIDIAN_LINK_" + linkPlaceholders.length + "__";
    linkPlaceholders.push({ placeholder, file, spec, fromFile });
    return placeholder;
  }

  function displayText(spec, file) {
    if (spec.alias && !(spec.embed && spec.width)) return spec.alias;
    if (!spec.target && spec.fragment) return "#" + spec.fragment;
    if (spec.target) return spec.target + (spec.fragment ? "#" + spec.fragment : "");
    return file?.stem ?? spec.raw;
  }

  function renderFileEmbed(file, spec) {
    const href = outputHref(file);
    const label = htmlEscape(spec.alias && !spec.width ? spec.alias : file.name);
    const sizeStyle =
      (spec.width ? "width: " + spec.width + "px;" : "") +
      (spec.height ? " height: " + spec.height + "px;" : "");
    const styleAttr = sizeStyle ? ' style="' + sizeStyle.trim() + '"' : "";

    if (IMAGE_EXTS.has(file.ext)) {
      return '<img class="obsidian-embed-image" src="' + href + '" alt="' + label + '"' + styleAttr + ">";
    }
    if (AUDIO_EXTS.has(file.ext) && !VIDEO_EXTS.has(file.ext)) {
      return '<audio class="obsidian-embed-audio" controls preload="metadata" src="' + href + '"><a href="' + href + '">' + label + "</a></audio>";
    }
    if (VIDEO_EXTS.has(file.ext)) {
      return '<video class="obsidian-embed-video" controls preload="metadata" src="' + href + '"' + styleAttr + '><a href="' + href + '">' + label + "</a></video>";
    }
    if (file.ext === ".pdf") {
      const params = new URLSearchParams(spec.fragment.replaceAll("#", "&"));
      const page = /^\d+$/.test(params.get("page") ?? "") ? params.get("page") : "";
      const height = /^\d+$/.test(params.get("height") ?? "") ? params.get("height") : "500";
      const pdfHref = href + (page ? "#page=" + page : "");
      return (
        '<object class="obsidian-embed-pdf" data="' + pdfHref + '" type="application/pdf" style="height: ' + height + 'px">' +
        '<a href="' + pdfHref + '">' + label + "</a></object>"
      );
    }
    return (
      '<a class="obsidian-file-embed" href="' + href + '" data-extension="' +
      htmlEscape(file.ext.slice(1)) + '"><span class="obsidian-file-embed-name">' + label +
      '</span><span class="obsidian-file-embed-kind">' + htmlEscape(file.ext.slice(1).toUpperCase()) + "</span></a>"
    );
  }

  function renderWikilink(tokens, idx, _options, env) {
    const spec = tokens[idx].meta.obsidian;
    const fromFile = env.obsidianFile;
    const file = resolveReference(spec, fromFile);
    const label = htmlEscape(displayText(spec, file));
    if (!file) {
      warn(
        "Unresolved Obsidian link " + JSON.stringify(spec.target || ("#" + spec.fragment)) +
          " in " + toPosix(path.relative(vault.root, fromFile))
      );
      if (spec.embed) {
        return '<span class="obsidian-embed unresolved" data-href="' + htmlEscape(spec.raw) + '">' + label + "</span>";
      }
      return '<span class="internal-link unresolved" data-href="' + htmlEscape(spec.raw) + '">' + label + "</span>";
    }

    if (!spec.embed) {
      const href = placeholderForLink(file, spec, fromFile);
      return '<a class="internal-link" href="' + href + '" data-href="' + htmlEscape(spec.raw) + '">' + label + "</a>";
    }
    if (file.ext !== ".md") return renderFileEmbed(file, spec);

    const id = embedSequence++;
    const marker = "<!--MHB_OBSIDIAN_NOTE_EMBED_" + id + "-->";
    noteEmbeds.set(id, { id, marker, file, spec, fromFile });
    return marker;
  }

  function enhanceMermaidInternalLinks(source, env) {
    if (!/^\s*(?:flowchart|graph)\b/im.test(source)) return source;
    const labels = new Map();
    const nodePattern = /(?:^|[\s;])([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\[\s*"?([^\]"]+)"?\s*\]|\(\s*"?([^\)"]+)"?\s*\)|\{\s*"?([^\}"]+)"?\s*\})/gm;
    for (const match of source.matchAll(nodePattern)) {
      labels.set(match[1], (match[2] ?? match[3] ?? match[4] ?? match[1]).trim());
    }

    const additions = [];
    const linked = new Set();
    const classPattern = /^\s*class\s+(.+?)\s+([^;]+);?\s*$/gm;
    for (const match of source.matchAll(classPattern)) {
      const classes = match[2].split(/[\s,]+/).filter(Boolean);
      if (!classes.includes("internal-link")) continue;
      for (const rawId of match[1].split(",")) {
        const nodeExpression = rawId.trim();
        const nodeId = nodeExpression.replace(/^"|"$/g, "");
        if (!nodeId || linked.has(nodeId)) continue;
        linked.add(nodeId);
        if (new RegExp("^\\s*click\\s+" + nodeId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "m").test(source)) {
          continue;
        }
        const target = labels.get(nodeId) ?? nodeId;
        const spec = { target, fragment: "", alias: "", embed: false, raw: target };
        const file = resolveReference(spec, env.obsidianFile);
        if (!file) {
          warn(
            "Unresolved Mermaid internal-link node " + JSON.stringify(target) + " in " +
              toPosix(path.relative(vault.root, env.obsidianFile))
          );
          continue;
        }
        const href = placeholderForLink(file, spec, env.obsidianFile);
        const tooltip = target.replaceAll('"', "'");
        additions.push(`click ${nodeExpression} href "${href}" "${tooltip}" _self`);
      }
    }
    return additions.length ? source.trimEnd() + "\n" + additions.join("\n") + "\n" : source;
  }

  function wikilinkRule(state, silent) {
    const start = state.pos;
    const embed = state.src[start] === "!" && state.src.slice(start + 1, start + 3) === "[[";
    if (!embed && state.src.slice(start, start + 2) !== "[[") return false;
    const contentStart = start + (embed ? 3 : 2);
    let close = contentStart;
    while (close < state.posMax - 1) {
      if (state.src.slice(close, close + 2) === "]]" && state.src[close - 1] !== "\\") break;
      close += 1;
    }
    if (close >= state.posMax - 1) return false;
    if (silent) return true;
    const token = state.push(embed ? "obsidian_embed" : "obsidian_wikilink", "", 0);
    token.meta = {
      obsidian: parseObsidianReference(state.src.slice(contentStart, close), { embed })
    };
    state.pos = close + 2;
    return true;
  }

  function tagRule(state, silent) {
    const start = state.pos;
    if (state.src[start] !== "#" || state.src[start - 1] === "\\") return false;
    const previous = start === 0 ? "" : state.src[start - 1];
    if (previous && !/[\s([{>]/u.test(previous)) return false;
    const match = state.src.slice(start + 1).match(/^[\p{L}\p{N}\p{Extended_Pictographic}_/-]+/u);
    if (!match || !/[\p{L}\p{Extended_Pictographic}_-]/u.test(match[0])) return false;
    if (silent) return true;
    const token = state.push("obsidian_tag", "span", 0);
    token.content = match[0];
    state.pos = start + match[0].length + 1;
    return true;
  }

  function actualBlockId(filePath, identifier, docId) {
    const rel = toPosix(path.relative(vault.root, filePath));
    return "obsidian-block-" + (slug(rel) || "note") + "-" + identifier + "-" + (slug(docId) || "doc");
  }

  function recordBlock(env, identifier, actual) {
    const record = noteRecord(env.obsidianFile);
    const entries = record.blocks.get(normalizeKey(identifier)) ?? [];
    entries.push({ id: actual, transcluded: Boolean(env.obsidianTransclusion) });
    record.blocks.set(normalizeKey(identifier), entries);
  }

  function transformBlockIds(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type !== "inline") continue;
      const match = token.content.match(BLOCK_ID_RE);
      if (!match) continue;
      const identifier = match[1];
      const actual = actualBlockId(state.env.obsidianFile, identifier, state.env.docId);

      if (token.content.trim() === "^" + identifier) {
        token.type = "html_block";
        token.tag = "";
        token.children = null;
        token.content = '<span class="obsidian-block-anchor" id="' + actual + '"></span>';
        if (tokens[i - 1]?.type === "paragraph_open") {
          tokens[i - 1].hidden = true;
          if (tokens[i + 1]?.type === "paragraph_close") tokens[i + 1].hidden = true;
        }
      } else {
        token.content = token.content.replace(BLOCK_ID_RE, "");
        removeBlockIdFromChildren(token.children ?? [], identifier);
        let openIndex = i - 1;
        while (openIndex >= 0 && tokens[openIndex].nesting !== 1) openIndex -= 1;
        const open = tokens[openIndex];
        if (open) open.attrSet("id", actual);
      }
      recordBlock(state.env, identifier, actual);
    }
  }

  function transformTasks(state) {
    const Token = state.Token;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i += 1) {
      const inline = tokens[i];
      if (inline.type !== "inline") continue;
      const task = inline.content.match(/^\[([^\]])\][ \t]+/);
      if (!task) continue;
      let itemIndex = i - 1;
      while (itemIndex >= 0 && tokens[itemIndex].type !== "list_item_open") itemIndex -= 1;
      if (itemIndex < 0) continue;

      const marker = task[1];
      const checked = marker !== " ";
      inline.content = inline.content.slice(task[0].length);
      const children = inline.children ?? [];
      for (const child of children) {
        if (child.type !== "text") continue;
        child.content = child.content.replace(/^\[([^\]])\][ \t]+/, "");
        break;
      }
      const checkbox = new Token("html_inline", "", 0);
      checkbox.content =
        '<input class="task-list-item-checkbox" type="checkbox" disabled' +
        (checked ? " checked" : "") + ' data-task="' + htmlEscape(marker) + '"> ';
      children.unshift(checkbox);
      inline.children = children;
      tokens[itemIndex].attrJoin("class", "task-list-item");
      tokens[itemIndex].attrSet("data-task", marker);

      let listIndex = itemIndex - 1;
      while (listIndex >= 0 && !["bullet_list_open", "ordered_list_open"].includes(tokens[listIndex].type)) listIndex -= 1;
      if (listIndex >= 0) tokens[listIndex].attrJoin("class", "contains-task-list");
    }
  }

  function transformCallouts(state) {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i += 1) {
      const open = tokens[i];
      if (open.type !== "blockquote_open") continue;
      let closeIndex = i + 1;
      while (
        closeIndex < tokens.length &&
        !(tokens[closeIndex].type === "blockquote_close" && tokens[closeIndex].level === open.level)
      ) closeIndex += 1;
      if (closeIndex >= tokens.length) continue;

      let inlineIndex = i + 1;
      while (inlineIndex < closeIndex && tokens[inlineIndex].type !== "inline") inlineIndex += 1;
      if (inlineIndex >= closeIndex) continue;
      const inline = tokens[inlineIndex];
      const firstLine = inline.content.split("\n", 1)[0];
      const marker = firstLine.match(/^\[!([A-Za-z0-9_-]+)\]([+-])?(?:[ \t]+(.*))?$/);
      if (!marker) continue;

      const type = marker[1].toLowerCase();
      const fold = marker[2] ?? "";
      const title = marker[3]?.trim() || titleCase(type);
      open.type = "obsidian_callout_open";
      open.tag = fold ? "details" : "div";
      open.meta = { obsidianCallout: { type, fold, title } };
      const close = tokens[closeIndex];
      close.type = "obsidian_callout_close";
      close.tag = open.tag;
      close.meta = { obsidianCallout: { fold } };

      const newline = inline.content.indexOf("\n");
      inline.content = newline === -1 ? "" : inline.content.slice(newline + 1);
      const breakIndex = (inline.children ?? []).findIndex((child) => child.type === "softbreak");
      inline.children = breakIndex === -1 ? [] : inline.children.slice(breakIndex + 1);
    }
  }

  function recordHeadings(state) {
    const record = noteRecord(state.env.obsidianFile);
    const hierarchy = [];
    for (let i = 0; i + 1 < state.tokens.length; i += 1) {
      const open = state.tokens[i];
      const inline = state.tokens[i + 1];
      if (open.type !== "heading_open" || inline.type !== "inline") continue;
      const id = open.attrGet("id");
      if (!id) continue;
      const level = Number(open.tag.slice(1));
      const heading = normalizeHeading(inline.content);
      hierarchy[level - 1] = heading;
      hierarchy.length = level;
      const entry = { id, transcluded: Boolean(state.env.obsidianTransclusion) };
      record.first.push(entry);
      for (const key of [heading, hierarchy.filter(Boolean).join("#")]) {
        const entries = record.headings.get(key) ?? [];
        entries.push(entry);
        record.headings.set(key, entries);
      }
    }
  }

  function install(md) {
    md.inline.ruler.before("link", "obsidian_wikilink", wikilinkRule);
    md.inline.ruler.before("emphasis", "obsidian_tag", tagRule);
    md.renderer.rules.obsidian_wikilink = renderWikilink;
    md.renderer.rules.obsidian_embed = renderWikilink;
    md.renderer.rules.obsidian_tag = (tokens, idx) => {
      const tag = tokens[idx].content;
      return '<span class="obsidian-tag" data-tag="' + htmlEscape(tag) + '">#' + htmlEscape(tag) + "</span>";
    };
    md.renderer.rules.obsidian_callout_open = (tokens, idx, _options, env) => {
      const { type, fold, title } = tokens[idx].meta.obsidianCallout;
      const titleHtml = md.renderInline(title, env);
      if (fold) {
        return (
          '<details class="callout callout-' + htmlEscape(type) + ' is-collapsible" data-callout="' + htmlEscape(type) + '"' +
          (fold === "+" ? " open" : "") + '><summary class="callout-title">' + titleHtml +
          '</summary><div class="callout-content">\n'
        );
      }
      return (
        '<div class="callout callout-' + htmlEscape(type) + '" data-callout="' + htmlEscape(type) + '">' +
        '<div class="callout-title">' + titleHtml + '</div><div class="callout-content">\n'
      );
    };
    md.renderer.rules.obsidian_callout_close = (tokens, idx) =>
      tokens[idx].meta.obsidianCallout.fold ? "</div></details>\n" : "</div></div>\n";

    md.core.ruler.before("anchor", "obsidian_syntax", (state) => {
      transformCallouts(state);
      transformBlockIds(state);
      transformTasks(state);
    });
    md.core.ruler.after("anchor", "obsidian_metadata", (state) => recordHeadings(state));

    const defaultFence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const language = tokens[idx].info.trim().split(/\s+/, 1)[0].toLowerCase();
      if (language !== "mermaid") return defaultFence(tokens, idx, options, env, self);
      usesMermaid = true;
      const source = enhanceMermaidInternalLinks(tokens[idx].content, env);
      return '<pre class="mermaid">' + htmlEscape(source) + "</pre>\n";
    };
  }

  function renderProperties(properties, raw, md, env) {
    if (propertiesMode === "hidden" || Object.keys(properties).length === 0) return "";
    if (propertiesMode === "source") {
      return '<pre class="obsidian-properties-source"><code class="language-yaml">---\n' + htmlEscape(raw) + "\n---</code></pre>\n";
    }

    const renderPropertyText = (text) => {
      const pattern = /\[\[[^\]\n]+\]\]|https?:\/\/[^\s<]+/g;
      let output = "";
      let index = 0;
      for (const match of text.matchAll(pattern)) {
        output += htmlEscape(text.slice(index, match.index));
        if (match[0].startsWith("[[")) {
          output += md.renderInline(match[0], env);
        } else {
          output +=
            '<a href="' + htmlEscape(match[0]) + '" target="_blank" rel="noopener noreferrer">' +
            htmlEscape(match[0]) + "</a>";
        }
        index = match.index + match[0].length;
      }
      return output + htmlEscape(text.slice(index));
    };

    const scalar = (value, key) => {
      if (typeof value === "boolean") {
        return '<input type="checkbox" disabled' + (value ? " checked" : "") + ">";
      }
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return htmlEscape(JSON.stringify(value));
      const text = String(value);
      if (key === "tags") {
        const tag = text.replace(/^#/, "");
        return '<span class="obsidian-tag" data-tag="' + htmlEscape(tag) + '">#' + htmlEscape(tag) + "</span>";
      }
      return renderPropertyText(text);
    };

    const rows = Object.entries(properties)
      .map(([key, value]) => {
        const values = Array.isArray(value) ? value : [value];
        return (
          '<div class="obsidian-property"><dt>' + htmlEscape(key) + "</dt><dd>" +
          values.map((item) => '<span class="obsidian-property-value">' + scalar(item, key) + "</span>").join("") +
          "</dd></div>"
        );
      })
      .join("");
    return '<dl class="obsidian-properties" aria-label="Properties">' + rows + "</dl>\n";
  }

  function extractNoteSource(file, spec) {
    const parsed = parseObsidianFrontmatter(fs.readFileSync(file.absPath, "utf8"));
    const clean = stripObsidianComments(parsed.body);
    if (!spec.fragment) return clean;
    if (spec.fragment.startsWith("^")) return extractBlock(clean, spec.fragment.slice(1));
    return extractHeadingSection(clean, spec.fragment);
  }

  function expandNoteEmbeds(html, renderNote) {
    let output = html;
    const ids = [...output.matchAll(/<!--MHB_OBSIDIAN_NOTE_EMBED_(\d+)-->/g)].map((match) => Number(match[1]));
    for (const id of ids) {
      const embed = noteEmbeds.get(id);
      if (!embed) continue;
      const source = extractNoteSource(embed.file, embed.spec);
      let rendered;
      if (source === null) {
        warn("Missing Obsidian embed fragment " + JSON.stringify(embed.spec.fragment) + " in " + embed.file.relPath);
        rendered = {
          blockHtml: '<div class="obsidian-note-embed unresolved">Missing embed: ' + htmlEscape(embed.spec.raw) + "</div>",
          inlineHtml: '<span class="obsidian-note-embed unresolved">' + htmlEscape(embed.spec.raw) + "</span>"
        };
      } else {
        rendered = renderNote(embed, source);
      }
      const escapedMarker = embed.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const paragraph = new RegExp("<p>\\s*" + escapedMarker + "\\s*</p>");
      if (paragraph.test(output)) output = output.replace(paragraph, rendered.blockHtml);
      output = output.replaceAll(embed.marker, rendered.inlineHtml);
    }
    return output;
  }

  function bestEntry(entries) {
    return entries?.find((entry) => !entry.transcluded) ?? entries?.[0] ?? null;
  }

  function finalHref(link) {
    const { file, spec } = link;
    if (file.ext !== ".md") return outputHref(file);
    const record = noteRecords.get(file.absPath);
    if (record) {
      if (spec.fragment.startsWith("^")) {
        const entry = bestEntry(record.blocks.get(normalizeKey(spec.fragment.slice(1))));
        if (entry) return "#" + entry.id;
      } else if (spec.fragment) {
        const key = spec.fragment.split("#").filter(Boolean).map(normalizeHeading).join("#");
        const entry = bestEntry(record.headings.get(key)) ?? bestEntry(record.headings.get(normalizeHeading(spec.fragment.split("#").at(-1))));
        if (entry) return "#" + entry.id;
      } else {
        const entry = bestEntry(record.first);
        if (entry) return "#" + entry.id;
      }
    }
    return outputHref(file);
  }

  function finalizeLinks(html) {
    let output = html;
    for (const link of linkPlaceholders) output = output.replaceAll(link.placeholder, finalHref(link));
    return output;
  }

  function rewriteMarkdownLink(href, env) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
    let decoded = href;
    try {
      decoded = decodeURI(href);
    } catch {
      // Keep authored href.
    }
    const hash = decoded.indexOf("#");
    const target = hash === -1 ? decoded : decoded.slice(0, hash);
    const fragment = hash === -1 ? "" : decoded.slice(hash + 1);
    if (!target && !fragment) return null;
    const spec = { target, fragment, alias: "", embed: false, raw: decoded };
    const file = resolveReference(spec, env.obsidianFile);
    if (!file) return null;
    return placeholderForLink(file, spec, env.obsidianFile);
  }

  function rewriteMarkdownImage(src, env) {
    if (!src || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return null;
    let decoded = src;
    try {
      decoded = decodeURI(src);
    } catch {
      // Keep authored source.
    }
    const target = decoded.split("#", 1)[0].split("?", 1)[0];
    const file = resolveReference(
      { target, fragment: "", alias: "", embed: false, raw: decoded },
      env.obsidianFile
    );
    return file && IMAGE_EXTS.has(file.ext) ? outputHref(file) : null;
  }

  function copyReferencedFiles(distDir) {
    for (const absPath of referencedFiles) {
      const rel = path.relative(vault.root, absPath);
      if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
      const target = path.join(distDir, "vault", rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(absPath, target);
    }
  }

  return {
    vault,
    install,
    prepareSource,
    renderProperties,
    expandNoteEmbeds,
    finalizeLinks,
    rewriteMarkdownLink,
    rewriteMarkdownImage,
    copyReferencedFiles,
    warnings,
    get usesMermaid() {
      return usesMermaid;
    }
  };
}

export const OBSIDIAN_ACCEPTED_EXTENSIONS = Object.freeze([...ACCEPTED_EXTS]);
