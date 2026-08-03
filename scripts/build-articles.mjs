// Regenerates articles/<Name>/index.html for every PDF in articles/,
// and rewrites the auto-generated listing block in articles/index.html.
// Run this any time a PDF is added to or removed from the articles/ folder
// (the GitHub Actions workflow runs it automatically on every push).

import { readdirSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const articlesDir = join(root, "articles");

const GENERATED_MARKER = ".generated-by-build-articles";
const LIST_START = "<!-- ARTICLES-LIST:START -->";
const LIST_END = "<!-- ARTICLES-LIST:END -->";

function articlePageHtml(name) {
  const pdfFile = `${name}.pdf`;
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name} | Arbor Vitae</title>
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body>
    <header class="site-header">
      <div class="brand-block">
        <a href="../../" class="brand">Arbor Vitae</a>
      </div>
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="../../">Welcome</a>
        <a href="../../about/">About Us</a>
        <a href="../" class="active">Journals and Articles</a>
        <a href="../../people/">Our People</a>
        <a href="../../contact/">Contact/Join Us</a>
      </nav>
    </header>

    <main class="page-content">
      <section class="hero">
        <p class="section-label"><a href="../">Journals and Articles</a></p>
        <h1>${name}</h1>
        <p class="intro">
          <a href="../${encodeURIComponent(pdfFile)}" download>Download the PDF</a>
        </p>
      </section>

      <section class="pdf-viewer">
        <iframe src="../${encodeURIComponent(pdfFile)}" title="${name}"></iframe>
      </section>
    </main>
  </body>
</html>
`;
}

function articlesIndexList(names) {
  if (names.length === 0) {
    return `      <p class="intro">No articles have been posted yet. Check back soon.</p>\n`;
  }
  const cards = names
    .map(
      (name) => `        <a class="card" href="./${encodeURIComponent(name)}/">
          <h2>${name}</h2>
          <p>Read online or download the PDF.</p>
        </a>`
    )
    .join("\n");
  return `      <section class="card-grid">\n${cards}\n      </section>\n`;
}

// Returns when a PDF was first uploaded, as a timestamp in ms: the date of the
// git commit that added it, falling back to the file's mtime when git history
// isn't available (e.g. a PDF that hasn't been committed yet).
function getUploadedAt(pdfFileName) {
  try {
    const output = execFileSync(
      "git",
      ["log", "--follow", "--diff-filter=A", "--format=%at", "--reverse", "--", join("articles", pdfFileName)],
      { cwd: root, encoding: "utf8" }
    ).trim();
    const firstTimestamp = output.split("\n")[0];
    if (firstTimestamp) return Number(firstTimestamp) * 1000;
  } catch {
    // Not a git repo, or git isn't installed — fall back to mtime below.
  }
  return statSync(join(articlesDir, pdfFileName)).mtimeMs;
}

function main() {
  const entries = readdirSync(articlesDir, { withFileTypes: true });

  const pdfNames = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => ({ name: e.name.slice(0, -4).trim(), uploadedAt: getUploadedAt(e.name) }))
    .sort((a, b) => b.uploadedAt - a.uploadedAt)
    .map((e) => e.name);

  // Remove previously generated article folders that no longer have a matching PDF.
  const existingDirs = entries.filter((e) => e.isDirectory());
  for (const dir of existingDirs) {
    const markerPath = join(articlesDir, dir.name, GENERATED_MARKER);
    if (existsSync(markerPath) && !pdfNames.includes(dir.name)) {
      rmSync(join(articlesDir, dir.name), { recursive: true, force: true });
    }
  }

  // Generate/refresh a page for each PDF.
  for (const name of pdfNames) {
    const dir = join(articlesDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), articlePageHtml(name), "utf8");
    writeFileSync(join(dir, GENERATED_MARKER), "", "utf8");
  }

  // Rewrite the listing block inside articles/index.html.
  const indexPath = join(articlesDir, "index.html");
  const current = readFileSync(indexPath, "utf8");
  const startIdx = current.indexOf(LIST_START);
  const endIdx = current.indexOf(LIST_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find ${LIST_START} / ${LIST_END} markers in articles/index.html`
    );
  }
  const before = current.slice(0, startIdx + LIST_START.length);
  const after = current.slice(endIdx);
  const updated = `${before}\n${articlesIndexList(pdfNames)}      ${after}`;
  writeFileSync(indexPath, updated, "utf8");

  console.log(`Generated pages for ${pdfNames.length} article(s): ${pdfNames.join(", ") || "(none)"}`);
}

main();
