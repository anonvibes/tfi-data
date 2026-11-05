# tfi-data

Data for [TFI Movies](https://tfi-movies.vercel.app).

`91mobiles.json` lists films and series from 91mobiles' [OTT releases this week](https://www.91mobiles.com/entertainment/ott-release-this-week) page, with 120 days of history. The site blocks servers, so a home server reads it every day at 5:00 IST with `update.mjs` and pushes any changes here. TFI Movies reads this file in its daily update.

Each entry: `title`, `date` (OTT release, YYYY-MM-DD), `platform`, `origLang` (TMDB language code), `type` (`film` or `series`), `ref` (the 91mobiles page).

`audio.json` is the daily Telugu audio check. Every title that could go in a TFI Movies dubbed catalog (from [`/candidates.json`](https://tfi-movies.vercel.app/candidates.json)) is looked up on [JustWatch](https://www.justwatch.com/in) and, for Netflix titles, on Netflix's title page, at 5:15 IST with `audio.mjs`. Keyed by TMDB id under `movie` and `tv`, each entry has `te` (`true`: Telugu audio listed; `false`: audio languages listed without Telugu; `null`: no service lists them), `langs`, `via` (where the answer came from), `checked` and `seen`. Titles without confirmed Telugu are checked again after a week.