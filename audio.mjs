// Telugu audio check for TFI Movies. Runs daily on a home server, in three steps around the downloads (the
// downloads happen outside; this script never uses the network):
//   node audio.mjs plan <work>     candidates-movie.json + candidates-tv.json -> jw/req-NNN.json (JustWatch queries)
//   node audio.mjs netflix <work>  jw/res-NNN.json -> jw-results.json, netflix-ids.txt (Netflix pages to download)
//   node audio.mjs finish <work>   jw-results.json + nf/<id>.html -> audio.json (in the current folder)
// audio.json: { updated, movie: { "<tmdb id>": entry }, tv: { ... } }, entry = { title, te, langs, via, checked, seen }.
// te: true = JustWatch, Netflix or ETV Win shows Telugu audio; false = audio languages are listed, without Telugu;
// null = no service lists them. TFI Movies keeps true and null in its dubbed catalogs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";

const [step, work] = process.argv.slice(2);
if (!["plan", "netflix", "finish"].includes(step) || !work) { console.error("usage: node audio.mjs plan|netflix|finish <work folder>"); process.exit(2); }
const TODAY = new Date().toISOString().slice(0, 10);
const RECHECK_DAYS = 7; // titles without confirmed Telugu are looked up again after this many days (dubs get added later)
const FORGET_DAYS = 60; // drop titles that haven't been a candidate for this long
const MAX_CHECKS = Number(process.env.MAX_CHECKS || 800); // per run; the rest wait for the next run
const BATCH = 12; // titles per JustWatch request (two searches each)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; } };

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const LANG_NAMES = { telugu: "te", tamil: "ta", hindi: "hi", malayalam: "ml", kannada: "kn", english: "en", bengali: "bn", marathi: "mr",
  gujarati: "gu", punjabi: "pa", odia: "or", japanese: "ja", korean: "ko", spanish: "es", french: "fr", german: "de", portuguese: "pt",
  italian: "it", thai: "th", turkish: "tr", indonesian: "id", arabic: "ar", chinese: "zh", mandarin: "zh", cantonese: "zh", russian: "ru", polish: "pl" };

function loadAudio() {
  const a = readJson("audio.json", {});
  return { movie: a.movie && typeof a.movie === "object" ? a.movie : {}, tv: a.tv && typeof a.tv === "object" ? a.tv : {} };
}

// ---- plan: which candidates need a (re)check, and the JustWatch queries for them ----
if (step === "plan") {
  const audio = loadAudio();
  const due = [];
  for (const media of ["movie", "tv"]) {
    const c = readJson(`${work}/candidates-${media}.json`, null);
    if (!c || !Array.isArray(c.items)) { console.error(`candidates-${media}.json missing or unreadable`); continue; }
    for (const it of c.items.slice(0, 5000)) {
      if (!Number.isInteger(it?.id) || typeof it.title !== "string") continue;
      const old = audio[media][it.id];
      if (old?.te === true || (old && daysBetween(old.checked, TODAY) < RECHECK_DAYS)) continue;
      due.push({ media, id: it.id, title: it.title.slice(0, 200), original: typeof it.original_title === "string" ? it.original_title.slice(0, 200) : null,
        year: Number.isInteger(it.year) ? it.year : null, lang: typeof it.lang === "string" ? it.lang.slice(0, 5) : null, isNew: !old });
    }
  }
  due.sort((a, b) => b.isNew - a.isNew); // never-checked titles first
  const todo = due.slice(0, MAX_CHECKS);
  mkdirSync(`${work}/jw`, { recursive: true });
  const fields = `edges { node { objectType content(country:$c, language:$l) { title originalReleaseYear externalIds { tmdbId } }
    offers(country:$c, platform:WEB) { monetizationType package { clearName } audioLanguages standardWebURL } } }`;
  for (let b = 0; b * BATCH < todo.length; b++) {
    const items = todo.slice(b * BATCH, (b + 1) * BATCH);
    const variables = { c: "IN", l: "en" }, parts = [], decl = [];
    items.forEach((it, i) => {
      const filter = (q) => ({ searchQuery: q, objectTypes: [it.media === "tv" ? "SHOW" : "MOVIE"], ...(it.year && it.media === "movie" ? { releaseYear: { min: it.year - 1, max: it.year + 1 } } : {}) });
      for (const [k, q] of [["a", it.title], ["b", it.original && norm(it.original) !== norm(it.title) ? it.original : null]]) {
        if (!q) continue;
        variables[`${k}${i}`] = filter(q);
        decl.push(`$${k}${i}:TitleFilter`);
        parts.push(`${k}${i}: popularTitles(country:$c, first:5, filter:$${k}${i}) { ${fields} }`);
      }
    });
    const query = `query Q($c:Country!,$l:Language!,${decl.join(",")}) { ${parts.join("\n")} }`;
    const n = String(b).padStart(3, "0");
    writeFileSync(`${work}/jw/req-${n}.json`, JSON.stringify({ query, variables }));
    writeFileSync(`${work}/jw/items-${n}.json`, JSON.stringify(items));
  }
  console.log(`plan: ${due.length} due, ${todo.length} checked this run, ${Math.ceil(todo.length / BATCH)} JustWatch requests`);
}

// ---- netflix: read the JustWatch answers, list the Netflix pages to download ----
if (step === "netflix") {
  const results = [];
  const nf = new Set();
  const files = existsSync(`${work}/jw`) ? readdirSync(`${work}/jw`).filter((f) => /^items-\d+\.json$/.test(f)).sort() : [];
  for (const f of files) {
    const items = readJson(`${work}/jw/${f}`, []);
    const res = readJson(`${work}/jw/${f.replace("items-", "res-")}`, null);
    items.forEach((it, i) => {
      if (!res?.data) { results.push({ ...it, failed: true }); return; } // JustWatch didn't answer: try again next run
      const nodes = [...(res.data[`a${i}`]?.edges || []), ...(res.data[`b${i}`]?.edges || [])].map((e) => e?.node).filter(Boolean);
      const titleOk = (n) => [it.title, it.original].filter(Boolean).some((t) => norm(t) === norm(n.content?.title));
      const yearOk = (n) => !it.year || !n.content?.originalReleaseYear || Math.abs(n.content.originalReleaseYear - it.year) <= 1;
      let node = nodes.find((n) => String(n.content?.externalIds?.tmdbId) === String(it.id));
      if (!node) {
        const byTitle = [...new Map(nodes.filter((n) => titleOk(n) && yearOk(n)).map((n) => [`${n.content.title}|${n.content.originalReleaseYear}`, n])).values()];
        if (byTitle.length === 1) node = byTitle[0];
      }
      if (!node) { results.push({ ...it, found: false }); return; }
      const packages = {};
      let netflixId = null;
      for (const o of Array.isArray(node.offers) ? node.offers : []) {
        const name = String(o?.package?.clearName || "").slice(0, 80);
        if (!name) continue;
        const langs = (Array.isArray(o.audioLanguages) ? o.audioLanguages : []).filter((l) => typeof l === "string" && /^[a-z]{2,3}$/.test(l));
        packages[name] = [...new Set([...(packages[name] || []), ...langs])];
        const m = /netflix/i.test(name) && String(o.standardWebURL || "").match(/netflix\.com\/(?:[a-z-]+\/)?title\/(\d{5,12})/);
        if (m) netflixId = m[1];
      }
      if (netflixId && !(packages.Netflix || []).length) nf.add(netflixId);
      results.push({ ...it, found: true, packages, netflixId });
    });
  }
  writeFileSync(`${work}/jw-results.json`, JSON.stringify(results));
  writeFileSync(`${work}/netflix-ids.txt`, [...nf].join("\n") + (nf.size ? "\n" : ""));
  console.log(`netflix: ${results.filter((r) => r.found).length} of ${results.length} found on JustWatch, ${nf.size} Netflix pages to read`);
}

// ---- finish: decide, and write audio.json ----
if (step === "finish") {
  const audio = loadAudio();
  const results = readJson(`${work}/jw-results.json`, []);
  // Netflix's public title page: "Audio" heading, then "Hindi - Audio Description, Hindi, Tamil [Original], and Telugu"
  const netflixLangs = (id) => {
    const p = `${work}/nf/${id}.html`;
    if (!/^\d{5,12}$/.test(String(id)) || !existsSync(p)) return null;
    const html = readFileSync(p, "utf8").slice(0, 3_000_000);
    const m = html.match(/>Audio<\/h\d>\s*<span[^>]*>([^<]{2,600})<\/span>/i);
    if (!m) return null;
    const names = m[1].replace(/&amp;/g, "&").split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.replace(/\s*-\s*Audio Description/i, "").replace(/\[Original\]/i, "").trim().toLowerCase()).filter(Boolean);
    return [...new Set(names.map((n) => LANG_NAMES[n.split(/\s+/)[0]] || n.slice(0, 20)))];
  };
  let counts = { te: 0, no: 0, unknown: 0, notFound: 0, failed: 0 };
  for (const r of results) {
    if (r.failed) { counts.failed++; continue; }
    const old = audio[r.media][r.id];
    let te = null, via = null, langs = [];
    if (r.found) {
      const lists = Object.entries(r.packages || {});
      // a provider's list that leaves out the original language is incomplete; it can confirm Telugu but not rule it out
      const complete = lists.filter(([, l]) => l.length && (!r.lang || l.includes(r.lang)));
      const nfl = r.netflixId ? netflixLangs(r.netflixId) : null;
      langs = [...new Set([...complete.flatMap(([, l]) => l), ...(nfl || [])])].sort();
      if (lists.some(([name]) => /etv ?win/i.test(name))) { te = true; via = "ETV Win"; }
      else if (lists.some(([, l]) => l.includes("te"))) { te = true; via = lists.filter(([, l]) => l.includes("te")).map(([n]) => n).join(", "); }
      else if (nfl?.includes("te")) { te = true; via = "Netflix"; }
      else if (complete.length || nfl?.length) { te = false; via = [...complete.map(([n]) => n), ...(nfl?.length ? ["Netflix"] : [])].join(", "); }
    }
    // a search that comes back empty this time doesn't undo an earlier "no Telugu"
    if (te === null && old?.te === false) ({ te, via, langs } = old);
    counts[te === true ? "te" : te === false ? "no" : r.found ? "unknown" : "notFound"]++;
    audio[r.media][r.id] = { title: r.title, te, langs, via, checked: TODAY, seen: TODAY, ...(r.found ? {} : { justwatch: "not found" }) };
  }
  // mark every current candidate as seen, forget old ones
  for (const media of ["movie", "tv"]) {
    const c = readJson(`${work}/candidates-${media}.json`, null);
    for (const it of c?.items || []) if (audio[media][it?.id]) audio[media][it.id].seen = TODAY;
    for (const [id, e] of Object.entries(audio[media])) if (!e?.seen || daysBetween(e.seen, TODAY) > FORGET_DAYS) delete audio[media][id];
  }
  // one title per line, so the daily change is easy to read on GitHub
  const block = (o) => `{\n${Object.keys(o).sort((a, b) => a - b).map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(o[k])}`).join(",\n")}\n  }`;
  writeFileSync("audio.json", `{\n  "updated": ${JSON.stringify(TODAY)},\n  "movie": ${block(audio.movie)},\n  "tv": ${block(audio.tv)}\n}\n`);
  console.log(`finish: Telugu ${counts.te}, no Telugu ${counts.no}, no audio info ${counts.unknown}, not on JustWatch ${counts.notFound}, JustWatch failed ${counts.failed};`,
    `audio.json has ${Object.keys(audio.movie).length} films and ${Object.keys(audio.tv).length} series`);
}
