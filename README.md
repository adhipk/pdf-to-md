# pdf-to-md

Extract all text from a PDF file using `pdftotext`.

Install dependencies:

```bash
bun install
```

Run extraction:

```bash
bun run extract -- PDF32000_2008.pdf
```

Default output file is `./index.html`.

Optional output path:

```bash
bun run extract -- PDF32000_2008.pdf ./output.html
```
