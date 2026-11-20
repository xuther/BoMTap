# BoM Tap

A daily guessing game: read a ~100–200 word passage from the Book of Mormon (no verse numbers, never crossing a chapter), then tap where it falls on a timeline of the whole book. Five passages a day, up to 100 points each.

## Run

No build step. Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How it works

- **Daily set** — seeded from the local date, so everyone gets the same 5 passages (each from a different chapter), ramping in difficulty: a Scripture Mastery verse, a well-known story chapter, then random passages with ≥2, ≤1 and 0 proper names (names are the biggest clues). The lists live in the difficulty section of `game.js`. Progress is saved in `localStorage`, so a refresh resumes rather than rerolls.
- **Timeline** — a zoomed tape (6px per verse) you drag or flick under a fixed needle, with chapter lines and verse ticks. Above it, an overview bar of the whole book (each book sized by verse count) shows where you are; tap or drag it to jump. Book/chapter/verse pickers and arrow keys also work (Shift = 10 verses, PgUp/PgDn = 100).
- **Scoring** — `100 · e^(−(d/1460)^0.8)` (75% of the book off ≈ 7 points), where `d` is the number of verses between your guess and the nearest verse of the passage (0 if you land inside it), with floors of 90 for the right chapter and 70 for the right book. Tune `CURVE_SCALE`, `CURVE_SHAPE` and the floors in `game.js`.
- **Practice** — unlimited random rounds after you finish the daily set.

## Data

`data/bom.js` is generated from [bcbooks/scriptures-json](https://github.com/bcbooks/scriptures-json):

```sh
curl -sSLo book-of-mormon.json https://raw.githubusercontent.com/bcbooks/scriptures-json/master/book-of-mormon.json
python3 tools/build_data.py book-of-mormon.json
```
