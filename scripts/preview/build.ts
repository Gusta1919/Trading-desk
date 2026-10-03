/**
 * Builds the online preview: the real app, with a snapshot of the running desk baked in.
 *
 *   npm start                 the desk, with the data to show (e.g. after `npm run demo:all`)
 *   npm run preview:build     → dist-preview/
 *
 * The page is the normal Vite build. Instead of the local server, scripts/preview/shim.js
 * answers the app's /api calls from the snapshot, so nothing in the app changes for it.
 * dist-preview/index.html holds only the page's content (title, styles, root, scripts):
 * the host that publishes it wraps it in the document shell.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { amsterdamClock } from "../../src/lib/dailyBias";

const API = "http://127.0.0.1:3848/api";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(root, "dist-preview");

async function get<T>(url: string): Promise<T> {
  const res = await fetch(`${API}${url}`);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function snapshot() {
  const versions = await get<{ version: string; stored?: boolean }[]>("/rulebook/versions");
  const versionDocs: Record<string, unknown> = {};
  for (const v of versions) {
    // 1.0 and 1.1 exist only as changelog rows; only stored versions can be opened.
    const res = await fetch(`${API}/rulebook/versions/${encodeURIComponent(v.version)}`);
    if (res.ok) versionDocs[v.version] = await res.json();
  }
  return {
    builtDay: amsterdamClock(new Date()).date,
    trades: await get("/trades"),
    limits: await get("/limits"),
    rulebook: await get("/rulebook"),
    versions,
    versionDocs,
    openItems: await get("/open-items"),
    checkins: await get("/checkins"),
    bias: await get<{ gmail?: unknown }>("/bias").then(({ gmail: _, ...b }) => b),
    newsRules: await get("/news/rules"),
  };
}

/*
 * The host's shell styles <body> outside any cascade layer (an off-white ground, the system
 * font, a light colour scheme), and unlayered rules beat the app's own, which Tailwind keeps
 * in `@layer base`. Restated here, unlayered too, from the app's own tokens.
 */
const HOST_SHELL_FIX = [
  ":root{color-scheme:light}",
  '@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){color-scheme:dark}}',
  ':root[data-theme="dark"]{color-scheme:dark}',
  "body{margin:0;background:var(--color-bg);color:var(--color-ink);font:14px/1.625 var(--font-sans)}",
].join("");

/*
 * The desk follows the system's light or dark setting. The host can also set the theme
 * itself (data-theme on the root), so the dark tokens answer to that too: an explicit
 * "light" keeps the light desk on a dark system, an explicit "dark" turns it dark.
 */
function themeFollowsHost(file: string) {
  const css = fs.readFileSync(file, "utf8");
  const dark = css.match(/@media ?\(prefers-color-scheme: ?dark\) ?\{:root\{([^}]*)\}\}/);
  if (!dark) throw new Error("The dark theme block wasn't found in the built CSS");
  const next = css.replace(
    dark[0],
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${dark[1]}}}:root[data-theme="dark"]{${dark[1]}}`,
  );
  fs.writeFileSync(file, next);
}

async function main() {
  let data: Awaited<ReturnType<typeof snapshot>>;
  try {
    data = await snapshot();
  } catch (e) {
    throw new Error(`Couldn't read the desk (${(e as Error).message}). Start it first with \`npm start\`.`);
  }

  fs.rmSync(OUT, { recursive: true, force: true });
  await build({ root, base: "./", logLevel: "warn", build: { outDir: OUT, emptyOutDir: true } });

  const built = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  const css = [...built.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const js = [...built.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  if (!js.length) throw new Error("The build has no entry script");

  for (const href of css) themeFollowsHost(path.join(OUT, href));

  // `<` is escaped so no text in the data can close the script tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const page = [
    "<title>Gucci Trade Journal</title>",
    ...css.map((href) => `<link rel="stylesheet" href="${href}">`),
    `<style>${HOST_SHELL_FIX}</style>`,
    '<div id="root"></div>',
    `<script>window.__PREVIEW__ = ${json};</script>`,
    `<script>\n${fs.readFileSync(path.join(root, "scripts", "preview", "shim.js"), "utf8")}</script>`,
    ...js.map((src) => `<script type="module" src="${src}"></script>`),
    "",
  ].join("\n");
  fs.writeFileSync(path.join(OUT, "index.html"), page);

  const files = fs.readdirSync(path.join(OUT, "assets"));
  console.log(
    `Preview built in dist-preview/: ${(data.trades as unknown[]).length} trades, ` +
      `${(data.checkins as unknown[]).length} check-ins, ${files.length} asset files.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
