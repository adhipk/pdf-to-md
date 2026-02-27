import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const projectRoot = process.cwd();
const scriptPath = join(projectRoot, "index.ts");
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pdf-to-md-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeMockPdftotext(dir: string): string {
  const mockBin = join(dir, "mock-bin");
  mkdirSync(mockBin, { recursive: true });

  const script = `#!/bin/sh
mode="default"
for arg in "$@"; do
  if [ "$arg" = "-layout" ]; then mode="layout"; fi
  if [ "$arg" = "-raw" ]; then mode="raw"; fi
done

if [ "$mode" = "layout" ]; then
  printf 'LAYOUT PAGE 1\\fLAYOUT PAGE 2'
elif [ "$mode" = "raw" ]; then
  printf 'RAW PAGE 1\\fRAW PAGE 2'
else
  printf 'DEFAULT PAGE 1\\fDEFAULT PAGE 2'
fi
`;

  const pdftotextPath = join(mockBin, "pdftotext");
  writeFileSync(pdftotextPath, script, "utf8");
  chmodSync(pdftotextPath, 0o755);

  const pdftohtmlScript = `#!/bin/sh
out=""
for arg in "$@"; do
  out="$arg"
done
cat > "$out" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<pdf2xml>
  <page number="1" position="absolute" top="0" left="0" height="1000" width="800">
    <fontspec id="0" size="18" family="MockSans" color="#000000"/>
    <fontspec id="1" size="12" family="MockSans" color="#000000"/>
    <text top="120" left="80" width="220" height="20" font="0"><b>INTRODUCTION</b></text>
    <text top="160" left="80" width="500" height="14" font="1">This is a semantic paragraph line one.</text>
    <text top="176" left="80" width="500" height="14" font="1">This is semantic paragraph line two.</text>
  </page>
  <page number="2" position="absolute" top="0" left="0" height="1000" width="800">
    <fontspec id="1" size="12" family="MockSans" color="#000000"/>
    <text top="140" left="80" width="500" height="14" font="1">Second page semantic content.</text>
  </page>
</pdf2xml>
XML
`;
  const pdftohtmlPath = join(mockBin, "pdftohtml");
  writeFileSync(pdftohtmlPath, pdftohtmlScript, "utf8");
  chmodSync(pdftohtmlPath, 0o755);
  return mockBin;
}

function runExtractor(
  cwd: string,
  args: string[],
  pathPrefix: string,
): { exitCode: number; stdout: string; stderr: string } {
  const run = Bun.spawnSync({
    cmd: ["bun", "run", scriptPath, ...args],
    cwd,
    env: {
      ...process.env,
      PATH: `${pathPrefix}:${process.env.PATH ?? ""}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: run.exitCode,
    stdout: new TextDecoder().decode(run.stdout),
    stderr: new TextDecoder().decode(run.stderr),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("extractor CLI", () => {
  test("uses default input/output and generates comparison HTML", () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, "index.pdf"), "%PDF-1.4 mock", "utf8");
    const mockBin = makeMockPdftotext(cwd);

    const result = runExtractor(cwd, [], mockBin);
    expect(result.exitCode).toBe(0);

    const html = Bun.file(join(cwd, "index.html")).text();
    return html.then((content) => {
      expect(content).toContain("PDF Viewer:");
      expect(content).toContain("modeButtons");
      expect(content).toContain("Prev");
      expect(content).toContain("const payloadBase64 =");
      expect(content).toContain("index.pdf");
    });
  });

  test("supports explicit input/output args with -- separator", async () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, "paper.pdf"), "%PDF-1.4 mock", "utf8");
    const mockBin = makeMockPdftotext(cwd);

    const result = runExtractor(cwd, ["--", "paper.pdf", "out.html"], mockBin);
    expect(result.exitCode).toBe(0);

    const content = await Bun.file(join(cwd, "out.html")).text();
    expect(content).toContain("paper.pdf");
  });

  test("refuses to write HTML output to .pdf path", () => {
    const cwd = makeTempDir();
    writeFileSync(join(cwd, "index.pdf"), "%PDF-1.4 mock", "utf8");
    const mockBin = makeMockPdftotext(cwd);

    const result = runExtractor(cwd, ["index.pdf", "bad.pdf"], mockBin);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Refusing to write HTML output to PDF path");
  });
});
