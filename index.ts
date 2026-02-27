import { basename } from "node:path";

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

const payloadBase64 = Buffer.from(JSON.stringify(payloads), "utf8").toString(
  "base64",
);
const title = basename(inputPdf);
const safeTitle = escapeHtml(title);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Extraction Comparison: ${safeTitle}</title>
    <style>
      :root {
        --bg: #f4f6fb;
        --text: #111827;
        --muted: #6b7280;
        --card: #ffffff;
        --border: #d1d5db;
        --accent: #0d9488;
        --diff: #fff4d6;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
        line-height: 1.45;
        background: var(--bg);
        color: var(--text);
      }
      .topbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: grid;
        grid-template-columns: minmax(180px, 1fr) minmax(180px, 1fr) minmax(280px, 2fr);
        gap: 8px;
        align-items: center;
        padding: 6px 10px;
        border-bottom: 1px solid var(--border);
        background: #ffffffee;
        backdrop-filter: blur(6px);
      }
      .topbar-title {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-width: 0;
      }
      .topbar-title h1 {
        margin: 0;
        font-size: 14px;
        white-space: nowrap;
      }
      .topbar-title span {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .topbar-field {
        min-width: 0;
      }
      .topbar-field label {
        display: none;
      }
      .pages {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px;
      }
      .page-row {
        border: 1px solid var(--border);
        border-radius: 4px;
        background: #fff;
        overflow: hidden;
      }
      .page-row-head {
        padding: 4px 8px;
        font-weight: 600;
        border-bottom: 1px solid var(--border);
        background: #f7f7f7;
        font-size: 12px;
        color: var(--muted);
      }
      .page-row-body {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0;
      }
      .page-col {
        padding: 6px;
      }
      .page-col + .page-col {
        border-left: 1px solid var(--border);
      }
      .page-col-title {
        margin: 0 0 4px;
        color: var(--muted);
        font-size: 11px;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      .page-text {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
        line-height: 1.35;
      }
      select, input {
        width: 100%;
        margin: 0;
        padding: 4px 6px;
        border-radius: 4px;
        border: 1px solid var(--border);
        font: inherit;
      }
      .stats {
        color: var(--muted);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .loading {
        color: var(--muted);
        font-size: 12px;
        margin: 4px 8px;
      }
      @media (max-width: 960px) {
        .topbar {
          grid-template-columns: 1fr;
          position: static;
        }
        .page-row-body {
          grid-template-columns: 1fr;
        }
        .page-col + .page-col {
          border-left: 0;
          border-top: 1px solid var(--border);
        }
      }
    </style>
  </head>
  <body>
    <div class="topbar">
      <div class="topbar-title">
        <h1>PDF Compare</h1>
        <span>${safeTitle}</span>
      </div>
      <div class="topbar-field">
        <label for="leftVersion">Left Version</label>
        <select id="leftVersion"></select>
      </div>
      <div class="topbar-field">
        <label for="rightVersion">Right Version</label>
        <select id="rightVersion"></select>
      </div>
    </div>

    <div class="loading" id="loading">Rendering pages...</div>
    <div class="stats" id="stats" style="padding: 0 8px 6px;"></div>
    <div id="pages" class="pages"></div>

    <template id="pageTemplate">
      <article class="page-row">
        <header class="page-row-head"></header>
        <div class="page-row-body">
          <section class="page-col">
            <h3 class="page-col-title"></h3>
            <pre class="page-text"></pre>
          </section>
          <section class="page-col">
            <h3 class="page-col-title"></h3>
            <pre class="page-text"></pre>
          </section>
        </div>
      </article>
    </template>

    <div class="loading" id="done" style="display:none;">
      Done rendering all pages.
    </div>

    <script>
      const payloadBase64 = "${payloadBase64}";
      const payloadBytes = Uint8Array.from(atob(payloadBase64), (c) =>
        c.charCodeAt(0),
      );
      const versions = JSON.parse(new TextDecoder().decode(payloadBytes));
      const leftSelect = document.getElementById("leftVersion");
      const rightSelect = document.getElementById("rightVersion");
      const stats = document.getElementById("stats");
      const pagesRoot = document.getElementById("pages");
      const loading = document.getElementById("loading");
      const done = document.getElementById("done");
      const pageTemplate = document.getElementById("pageTemplate");

      function esc(s) {
        return s
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;");
      }

      function byId(id) {
        return versions.find((v) => v.id === id);
      }

      function setOptions(select, selected) {
        select.innerHTML = versions
          .map((v) => "<option value='" + v.id + "'>" + v.label + "</option>")
          .join("");
        select.value = selected;
      }

      function renderPageRow(pageNumber, left, right) {
        const node = pageTemplate.content.firstElementChild.cloneNode(true);
        const head = node.querySelector(".page-row-head");
        const leftTitle = node.querySelectorAll(".page-col-title")[0];
        const rightTitle = node.querySelectorAll(".page-col-title")[1];
        const leftText = node.querySelectorAll(".page-text")[0];
        const rightText = node.querySelectorAll(".page-text")[1];

        head.textContent = "Page " + pageNumber;
        leftTitle.textContent = left.label;
        rightTitle.textContent = right.label;
        leftText.textContent = left.pages[pageNumber - 1] || "";
        rightText.textContent = right.pages[pageNumber - 1] || "";

        return node;
      }

      function render() {
        const left = byId(leftSelect.value);
        const right = byId(rightSelect.value);
        const maxPage = Math.max(left.stats.pages, right.stats.pages);

        stats.textContent =
          left.label + ": " + left.stats.pages + " pages, " + left.stats.lines + " lines, " + left.stats.chars + " chars | " +
          right.label + ": " + right.stats.pages + " pages, " + right.stats.lines + " lines, " + right.stats.chars + " chars | " +
          "Showing all " + maxPage + " pages";

        pagesRoot.innerHTML = "";
        done.style.display = "none";
        loading.style.display = "block";

        let page = 1;
        const batchSize = 8;

        function renderBatch() {
          const fragment = document.createDocumentFragment();
          let count = 0;

          while (page <= maxPage && count < batchSize) {
            fragment.appendChild(renderPageRow(page, left, right));
            page += 1;
            count += 1;
          }

          pagesRoot.appendChild(fragment);

          if (page <= maxPage) {
            requestAnimationFrame(renderBatch);
            return;
          }

          loading.style.display = "none";
          done.style.display = "block";
        }

        requestAnimationFrame(renderBatch);
      }

      setOptions(leftSelect, versions[0]?.id || "");
      setOptions(rightSelect, versions[1]?.id || versions[0]?.id || "");

      leftSelect.addEventListener("change", render);
      rightSelect.addEventListener("change", render);

      render();
    </script>
  </body>
</html>
`;

await Bun.write(outputPath, html);
console.log(`Extracted all text to HTML: ${outputPath}`);
