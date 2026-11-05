# tfi-data

Data for [TFI Movies](https://tfi-movies.vercel.app).

`91mobiles.json` lists films and series from 91mobiles' [OTT releases this week](https://www.91mobiles.com/entertainment/ott-release-this-week) page, with 120 days of history. The site blocks servers, so a home server reads it every day at 5:00 IST with `update.mjs` and pushes any changes here. TFI Movies reads this file in its daily update.

Each entry: `title`, `date` (OTT release, YYYY-MM-DD), `platform`, `origLang` (TMDB language code), `type` (`film` or `series`), `ref` (the 91mobiles page).
