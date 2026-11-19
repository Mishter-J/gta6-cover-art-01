// Vice Cover Studio — entry program for make.fun gta6-cover-art-01 (program/v1).
//
// The app is plain static files under app/ (index.html, style.css, app.js plus
// fonts and sample photos), and screenshots/ holds four JPEGs taken with a real
// headless Chrome run of that app. This program hands both in: it copies app/
// and screenshots/ from beside this file into the output directory and writes
// /output/dossier.json with the vendored make.fun library, so the judge can
// read the app's source and see its screenshots.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

// Directory this file lives in — the repository root.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// The grader gives us a writable /output; locally we use MAKEFUN_OUTPUT_DIR.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The scorer's own caps: only text_max_bytes shapes the bytes, the rest refuse
// an entry the scorer would refuse (more than 4 screenshots or one over
// 256 KiB; more than 993 files in app/ or 48 MiB of app files in all, or a
// path under app/ over 1000 bytes — app/ shares /output's own 1000-entry cap
// with screenshots/ and dossier.json).
const dossierCaps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
  app_path_max_bytes: 1000,
};

function copyEntryTree() {
  mkdirSync(outputDir, { recursive: true });
  cpSync(join(repoRoot, 'app'), join(outputDir, 'app'), { recursive: true });
  mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
  const shots = join(repoRoot, 'screenshots');
  if (existsSync(shots)) {
    cpSync(shots, join(outputDir, 'screenshots'), { recursive: true });
  }
}

copyEntryTree();
writeFileSync(join(outputDir, 'dossier.json'), buildDossier(outputDir, dossierCaps));
