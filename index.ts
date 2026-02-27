import { basename } from "node:path";

function printUsage(): void {
  console.log("Usage: bun run extract -- <input.pdf> [output.html]");
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const [inputPdf, outputPathArg] = Bun.argv.slice(2);

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

const outputPath =
  outputPathArg ?? "./index.html";

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

const extract = Bun.spawnSync({
  cmd: ["pdftotext", "-enc", "UTF-8", inputPdf, "-"],
  stdout: "pipe",
  stderr: "pipe",
});

if (extract.exitCode !== 0) {
  const errorText = new TextDecoder().decode(extract.stderr);
  console.error("Failed to extract PDF text.");
  if (errorText.trim()) {
    console.error(errorText.trim());
  }
  process.exit(extract.exitCode);
}

const text = new TextDecoder().decode(extract.stdout);
const escaped = escapeHtml(text);
const title = basename(inputPdf);

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Extracted: ${title}</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1.45;
        background: #f6f7f9;
        color: #111;
      }
      pre {
        white-space: pre-wrap;
        word-wrap: break-word;
        background: #fff;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 16px;
      }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <pre>${escaped}</pre>
  </body>
</html>
`;

await Bun.write(outputPath, html);
console.log(`Extracted all text to HTML: ${outputPath}`);
