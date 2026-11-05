// Runs daily on a home server: adds this week's films and series from
// 91mobiles' "OTT releases this week" page to 91mobiles.json, keeping 120 days of history.
// TFI Movies (tfi-movies.vercel.app) reads that file in its daily update.
// Usage: node update.mjs <saved page.html>
import { readFileSync, writeFileSync } from "node:fs";

const DAYS = 120;
const LANGS = {
  telugu: "te", tamil: "ta", malayalam: "ml", kannada: "kn", hindi: "hi", english: "en", bengali: "bn",
  marathi: "mr", odia: "or", oriya: "or", punjabi: "pa", gujarati: "gu", bhojpuri: "bho", assamese: "as",
};
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const addDays = (s, n) => new Date(new Date(s + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…" };
const decode = (s) => String(s)
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html) => decode(String(html).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// "06 Nov 2026" -> "2026-11-06"
function parseDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/);
  const mon = m && MONTHS[m[2].toLowerCase()];
  return mon ? `${m[3]}-${pad(mon)}-${pad(m[1])}` : null;
}

// Cards: <a href="/entertainment/haiwaan-movie-223303" … data-action="movie-name">Haiwaan</a> … <p>Hindi | 06 Nov 2026 (OTT)</p>
// … <div … data-action="where-to-watch" …>Sony Liv</div>. The language is the film's original language.
export function parse91mobiles(html) {
  html = String(html);
  const hits = [...html.matchAll(/<a\b[^>]*href="(?:https?:\/\/www\.91mobiles\.com)?(\/entertainment\/[^"#?]+)"[^>]*data-action="movie-name"[^>]*>([\s\S]*?)<\/a>/gi)];
  const out = [];
  const seen = new Set();
  hits.forEach((m, i) => {
    const [, slug, name] = m;
    if (seen.has(slug)) return;
    const card = html.slice(m.index, hits[i + 1] ? hits[i + 1].index : m.index + 6000);
    const info = card.match(/<p\b[^>]*>\s*([A-Za-z]+)\s*\|\s*(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{4})\s*(?:\(OTT\))?\s*<\/p>/i);
    const date = info && parseDate(info[2]);
    if (!date) return;
    const platforms = [...card.matchAll(/data-action="where-to-watch"[^>]*>([\s\S]*?)<\//gi)].map((p) => text(p[1])).filter(Boolean);
    seen.add(slug);
    out.push({
      title: text(name), date, platform: platforms.join(", "), origLang: LANGS[info[1].toLowerCase()] || null,
      type: /-movie-\d+$/.test(slug) ? "film" : /-series-\d+$/.test(slug) ? "series" : null,
      ref: `https://www.91mobiles.com${slug}`,
    });
  });
  return out;
}

// Adds a day's cards to the saved history: films and series, last DAYS days, newest first.
export function merge(history, fresh, todayStr) {
  const byRef = new Map((history || []).map((e) => [e.ref, e]));
  for (const e of fresh) if (e.type === "film" || e.type === "series") byRef.set(e.ref, e);
  const from = addDays(todayStr, -DAYS);
  return [...byRef.values()].filter((e) => e.date >= from).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
}

if (process.argv[2]) {
  const file = new URL("./91mobiles.json", import.meta.url);
  const todayStr = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST
  let saved = { entries: [] };
  try { saved = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const fresh = parse91mobiles(readFileSync(process.argv[2], "utf8"));
  if (!fresh.length) { console.error("91mobiles: no films found on the page; its layout may have changed"); process.exit(2); }
  const entries = merge(saved.entries, fresh, todayStr);
  if (JSON.stringify(entries) === JSON.stringify(saved.entries)) { console.log(`91mobiles: ${fresh.length} on the page, nothing new`); process.exit(0); }
  writeFileSync(file, JSON.stringify({ source: "https://www.91mobiles.com/entertainment/ott-release-this-week", changed: todayStr, entries }, null, 1) + "\n");
  console.log(`91mobiles: ${fresh.length} on the page, ${entries.length} films and series saved`);
}
