import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

type ExtractVersion = {
  id: string;
  label: string;
  args: string[];
};

type VersionPayload = {
  id: string;
  label: string;
  args: string[];
  pages: string[];
  stats: {
    pages: number;
    lines: number;
    chars: number;
  };
};

type SemanticPayload = {
  pages: string[];
  stats: {
    pages: number;
    lines: number;
    chars: number;
  };
};

function printUsage(): void {
  console.log("Usage: bun run extract [input.pdf] [output.html]");
  console.log("Defaults: input=./index.pdf output=./index.html");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function extractText(inputPdfPath: string, extraArgs: string[]): string {
  const run = Bun.spawnSync({
    cmd: ["pdftotext", "-enc", "UTF-8", ...extraArgs, inputPdfPath, "-"],
    stdout: "pipe",
    stderr: "pipe",
  });

  if (run.exitCode !== 0) {
    const errorText = new TextDecoder().decode(run.stderr).trim();
    throw new Error(errorText || "Unknown pdftotext error");
  }

  return new TextDecoder().decode(run.stdout);
}

function buildPayload(version: ExtractVersion, text: string): VersionPayload {
  const normalized = text.replaceAll("\r\n", "\n");
  const pages = normalized.split("\f");
  const lines = normalized ? normalized.split("\n").length : 0;

  return {
    id: version.id,
    label: version.label,
    args: version.args,
    pages,
    stats: {
      pages: pages.length,
      lines,
      chars: normalized.length,
    },
  };
}

function decodeXmlEntities(text: string): string {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function attrsToMap(attrText: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrText)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

function buildSemanticFromXml(xml: string): SemanticPayload {
  type XmlLine = {
    col: number;
    top: number;
    left: number;
    fontSize: number;
    bold: boolean;
    text: string;
  };

  const pages: string[] = [];
  let totalLines = 0;
  let totalChars = 0;

  const pageRe = /<page\b([^>]*)>([\s\S]*?)<\/page>/g;
  let pageMatch: RegExpExecArray | null;

  while ((pageMatch = pageRe.exec(xml)) !== null) {
    const pageAttrs = attrsToMap(pageMatch[1]);
    const pageBody = pageMatch[2];
    const pageHeight = Number(pageAttrs.get("height") ?? "0");
    const pageWidth = Number(pageAttrs.get("width") ?? "0");

    const fontSizes = new Map<string, number>();
    const fontRe = /<fontspec\b([^>]*)\/>/g;
    let fontMatch: RegExpExecArray | null;
    while ((fontMatch = fontRe.exec(pageBody)) !== null) {
      const attrs = attrsToMap(fontMatch[1]);
      const id = attrs.get("id");
      const size = Number(attrs.get("size") ?? "0");
      if (id) fontSizes.set(id, size);
    }

    type Item = {
      top: number;
      left: number;
      fontSize: number;
      bold: boolean;
      text: string;
    };
    const items: Item[] = [];
    const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textRe.exec(pageBody)) !== null) {
      const attrs = attrsToMap(textMatch[1]);
      const top = Number(attrs.get("top") ?? "0");
      const left = Number(attrs.get("left") ?? "0");
      const fontId = attrs.get("font") ?? "";
      const fontSize = fontSizes.get(fontId) ?? 12;
      const bold = /<b>/.test(textMatch[2]);
      const text = decodeXmlEntities(textMatch[2].replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();

      if (!text) continue;
      if (pageHeight > 0 && (top < 80 || top > pageHeight - 80)) continue;
      if (/^PDF\s+\d/.test(text)) continue;
      if (/^©\s+Adobe Systems/.test(text)) continue;
      if (/^(Page\s+)?\d+$/.test(text)) continue;
      if (/^THIS PAGE BLANK$/i.test(text)) continue;

      items.push({ top, left, fontSize, bold, text });
    }

    const mid = pageWidth > 0 ? pageWidth / 2 : 0;
    const leftCount = items.filter((i) => i.left < mid - 40).length;
    const rightCount = items.filter((i) => i.left > mid + 40).length;
    const twoCol = pageWidth > 0 && leftCount > 25 && rightCount > 25;

    const sorted = items
      .map((i) => ({
        ...i,
        col: twoCol && i.left > mid ? 1 : 0,
      }))
      .sort((a, b) => a.col - b.col || a.top - b.top || a.left - b.left);

    const lines: XmlLine[] = [];
    for (const item of sorted) {
      const prev = lines[lines.length - 1];
      if (
        prev &&
        prev.col === item.col &&
        Math.abs(prev.top - item.top) <= 3 &&
        Math.abs(prev.left - item.left) < 500
      ) {
        prev.text += ` ${item.text}`;
        prev.fontSize = Math.max(prev.fontSize, item.fontSize);
        prev.bold = prev.bold || item.bold;
        continue;
      }
      lines.push({
        col: item.col,
        top: item.top,
        left: item.left,
        fontSize: item.fontSize,
        bold: item.bold,
        text: item.text,
      });
    }

    const out: string[] = [];
    let prevTop = -1;
    let prevCol = -1;
    for (const line of lines) {
      const lineText = line.text.replace(/\s+/g, " ").trim();
      if (!lineText) continue;
      if (prevTop !== -1) {
        if (line.col !== prevCol) out.push("");
        if (line.top - prevTop > Math.max(14, line.fontSize * 1.45)) out.push("");
      }
      out.push(lineText);
      prevTop = line.top;
      prevCol = line.col;
    }

    const pageText = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    pages.push(pageText);
    totalLines += pageText ? pageText.split("\n").length : 0;
    totalChars += pageText.length;
  }

  return {
    pages,
    stats: {
      pages: pages.length,
      lines: totalLines,
      chars: totalChars,
    },
  };
}

function extractSemanticStructured(inputPdfPath: string): SemanticPayload {
  const tmpBase = mkdtempSync(join(tmpdir(), "pdf-to-md-sem-"));
  const outXml = join(tmpBase, "structured.xml");

  try {
    const run = Bun.spawnSync({
      cmd: ["pdftohtml", "-xml", "-i", "-nodrm", "-q", inputPdfPath, outXml],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (run.exitCode !== 0) {
      const stderr = new TextDecoder().decode(run.stderr).trim();
      throw new Error(stderr || "pdftohtml failed");
    }
    const xml = readFileSync(outXml, "utf8");
    return buildSemanticFromXml(xml);
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

const rawArgs = Bun.argv.slice(2);
const args = rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
const inputPdf = args[0] ?? "./index.pdf";
const outputPathArg = args[1];

if (!inputPdf) {
  printUsage();
  process.exit(1);
}

if (!inputPdf.toLowerCase().endsWith(".pdf")) {
  console.error(`Input must be a PDF file. Received: ${inputPdf}`);
  process.exit(1);
}

if (!(await Bun.file(inputPdf).exists())) {
  console.error(`PDF not found: ${inputPdf}`);
  process.exit(1);
}

const outputPath = outputPathArg ?? "./index.html";

if (outputPath.toLowerCase().endsWith(".pdf")) {
  console.error(`Refusing to write HTML output to PDF path: ${outputPath}`);
  process.exit(1);
}

const pdftotextCheck = Bun.spawnSync({
  cmd: ["which", "pdftotext"],
  stdout: "ignore",
  stderr: "ignore",
});

if (pdftotextCheck.exitCode !== 0) {
  console.error("Missing dependency: pdftotext");
  console.error("Install poppler and retry.");
  process.exit(1);
}

const versions: ExtractVersion[] = [
  { id: "default", label: "Default", args: [] },
  { id: "layout", label: "Layout (-layout)", args: ["-layout"] },
  { id: "raw", label: "Raw Order (-raw)", args: ["-raw"] },
];

const payloads: VersionPayload[] = [];

for (const version of versions) {
  try {
    const text = extractText(inputPdf, version.args);
    payloads.push(buildPayload(version, text));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown extraction failure";
    console.error(`Failed to extract version "${version.label}": ${message}`);
    process.exit(1);
  }
}

let semantic: SemanticPayload;
try {
  semantic = extractSemanticStructured(inputPdf);
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown semantic extraction failure";
  console.error(`Failed to extract structured semantic content: ${message}`);
  process.exit(1);
}

const dashboardPayload = {
  versions: payloads,
  semantic,
};

const payloadBase64 = Buffer.from(JSON.stringify(dashboardPayload), "utf8").toString(
  "base64",
);
const title = basename(inputPdf);
const safeTitle = escapeHtml(title);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PDF Viewer: ${safeTitle}</title>
    <style>
      :root {
        --bg: #f5f5f5;
        --fg: #111;
        --muted: #666;
        --border: #d8d8d8;
        --panel: #fff;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--fg);
        font-family: ui-sans-serif, -apple-system, "Segoe UI", sans-serif;
      }
      .toolbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 8px;
        border-bottom: 1px solid var(--border);
        background: #fff;
      }
      .file {
        min-width: 0;
        max-width: 32vw;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 13px;
        color: var(--muted);
      }
      .spacer {
        flex: 1;
      }
      .group {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      button {
        border: 1px solid var(--border);
        background: #fff;
        color: var(--fg);
        border-radius: 4px;
        padding: 4px 9px;
        font-size: 13px;
        cursor: pointer;
      }
      button.active {
        background: #111;
        color: #fff;
        border-color: #111;
      }
      button:disabled {
        opacity: 0.5;
        cursor: default;
      }
      input[type="number"] {
        width: 68px;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 4px 6px;
        font-size: 13px;
      }
      .meta {
        padding: 5px 10px;
        font-size: 12px;
        color: var(--muted);
      }
      .viewer {
        height: calc(100vh - 76px);
        overflow: auto;
        padding: 8px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 4px;
      }
      .panel-head {
        padding: 6px 8px;
        border-bottom: 1px solid var(--border);
        font-size: 12px;
        color: var(--muted);
      }
      .two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .col + .col {
        border-left: 1px solid var(--border);
      }
      .content {
        margin: 0;
        padding: 10px;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        line-height: 1.35;
      }
      .semantic {
        padding: 10px;
      }
      .semantic h3 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .semantic h4 {
        margin: 10px 0 6px;
        font-size: 15px;
      }
      .semantic p,
      .semantic li {
        margin: 0 0 7px;
        line-height: 1.5;
      }
      @media (max-width: 900px) {
        .toolbar {
          flex-wrap: wrap;
        }
        .file {
          max-width: 100%;
          width: 100%;
          order: 3;
        }
        .two-col {
          grid-template-columns: 1fr;
        }
        .col + .col {
          border-left: 0;
          border-top: 1px solid var(--border);
        }
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div class="group" id="modeButtons">
        <button data-mode="compare" class="active">Compare</button>
        <button data-mode="semantic">Semantic</button>
        <button data-mode="true">Layout</button>
      </div>
      <div class="group">
        <button id="prevBtn">Prev</button>
        <input id="pageInput" type="number" min="1" value="1" />
        <span id="pageCount" style="font-size:12px;color:#666;">/ 1</span>
        <button id="nextBtn">Next</button>
      </div>
      <div class="spacer"></div>
      <div class="file">${safeTitle}</div>
    </div>
    <div class="meta" id="meta"></div>
    <main class="viewer" id="viewer"></main>

    <script>
      const payloadBase64 = "${payloadBase64}";
      const bytes = Uint8Array.from(atob(payloadBase64), (c) => c.charCodeAt(0));
      const payload = JSON.parse(new TextDecoder().decode(bytes));
      const versions = payload.versions || [];
      const semantic = payload.semantic || { pages: [], stats: { pages: 0, lines: 0, chars: 0 } };

      const modeButtons = document.getElementById("modeButtons");
      const pageInput = document.getElementById("pageInput");
      const pageCount = document.getElementById("pageCount");
      const prevBtn = document.getElementById("prevBtn");
      const nextBtn = document.getElementById("nextBtn");
      const meta = document.getElementById("meta");
      const viewer = document.getElementById("viewer");

      const defaultVer = versions.find((v) => v.id === "default") || versions[0];
      const layoutVer = versions.find((v) => v.id === "layout") || versions[0];
      const rawVer = versions.find((v) => v.id === "raw") || versions[0];

      let mode = "compare";
      let page = 1;

      function maxPages() {
        if (mode === "semantic") return Math.max(1, semantic.pages.length || 1);
        if (mode === "true") return Math.max(1, layoutVer?.pages?.length || 1);
        return Math.max(
          1,
          defaultVer?.pages?.length || 1,
          layoutVer?.pages?.length || 1,
        );
      }

      function safePageText(ver, n) {
        if (!ver || !Array.isArray(ver.pages)) return "";
        return ver.pages[n - 1] || "";
      }

      function clearActiveMode() {
        modeButtons.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      }

      function semanticHtml(pageText) {
        const lines = (pageText || "").split("\\n").map((s) => s.trim()).filter(Boolean);
        const blocks = [];
        let cur = [];
        for (const line of lines) {
          if (!line) continue;
          if (cur.length && /[.!?;:]$/.test(cur[cur.length - 1])) {
            blocks.push(cur);
            cur = [];
          }
          cur.push(line);
        }
        if (cur.length) blocks.push(cur);

        const out = [];
        for (const b of blocks) {
          const text = b.join(" ").replace(/\\s+/g, " ").trim();
          if (!text) continue;
          if (/^\\d+(\\.\\d+)*\\s+/.test(text) || (text.length < 90 && text === text.toUpperCase())) {
            out.push("<h4>" + text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + "</h4>");
          } else if (/^([\\-*•]|\\d+[.)]|\\[[0-9]+\\])\\s+/.test(text)) {
            out.push("<ul><li>" + text.replace(/^([\\-*•]|\\d+[.)]|\\[[0-9]+\\])\\s+/, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + "</li></ul>");
          } else {
            out.push("<p>" + text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + "</p>");
          }
        }
        return out.join("");
      }

      function render() {
        const max = maxPages();
        if (page < 1) page = 1;
        if (page > max) page = max;
        pageInput.value = String(page);
        pageInput.max = String(max);
        pageCount.textContent = "/ " + max;
        prevBtn.disabled = page <= 1;
        nextBtn.disabled = page >= max;

        if (mode === "compare") {
          meta.textContent =
            "Compare page " +
            page +
            " | Default vs Layout";
          viewer.innerHTML =
            '<section class="panel">' +
            '<header class="panel-head">Page ' + page + " | Default vs Layout</header>" +
            '<div class="two-col">' +
              '<div class="col"><pre class="content">' + (safePageText(defaultVer, page) || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + '</pre></div>' +
              '<div class="col"><pre class="content">' + (safePageText(layoutVer, page) || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + '</pre></div>' +
            "</div>" +
            "</section>";
          return;
        }

        if (mode === "semantic") {
          meta.textContent =
            "Semantic view page " +
            page +
            " | " +
            semantic.stats.pages +
            " pages, " +
            semantic.stats.lines +
            " lines";
          viewer.innerHTML =
            '<section class="panel">' +
            '<header class="panel-head">Page ' + page + " | Semantic</header>" +
            '<article class="semantic">' +
              "<h3>Page " + page + "</h3>" +
              semanticHtml(semantic.pages[page - 1] || "") +
            "</article>" +
            "</section>";
          return;
        }

        meta.textContent = "Layout view page " + page + " | Using -layout extraction";
        viewer.innerHTML =
          '<section class="panel">' +
          '<header class="panel-head">Page ' + page + " | Layout</header>" +
          '<pre class="content">' + (safePageText(layoutVer, page) || "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;") + '</pre>' +
          "</section>";
      }

      modeButtons.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLButtonElement)) return;
        const nextMode = target.getAttribute("data-mode");
        if (!nextMode) return;
        mode = nextMode;
        clearActiveMode();
        target.classList.add("active");
        page = 1;
        render();
      });

      prevBtn.addEventListener("click", () => {
        page -= 1;
        render();
      });
      nextBtn.addEventListener("click", () => {
        page += 1;
        render();
      });
      pageInput.addEventListener("change", () => {
        page = Number(pageInput.value || "1");
        render();
      });

      render();
    </script>
  </body>
</html>
`;

await Bun.write(outputPath, html);
console.log(`Extracted all text to HTML: ${outputPath}`);
