# BoM Tap

A daily guessing game: read a ~100–200 word passage from the Book of Mormon (no verse numbers, never crossing a chapter), then tap where it falls on a timeline of the whole book. Five passages a day, up to 100 points each.

## Run

No build step. Open `index.html` directly, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

## How it works

- **Daily set** — seeded from the local date, so everyone gets the same 5 passages (each from a different chapter), ramping in difficulty. Difficulty comes from how often General Conference (2005–present) cites each verse: round 1 starts at one of the 50 most-cited verses or a Scripture Mastery verse, and rounds 2–5 come from successively less-cited bands of all passages, ending with ones nobody quotes.
- **Timeline** — a zoomed tape (6px per verse) you drag or flick under a fixed needle, with chapter lines and verse ticks. Above it, an overview bar of the whole book (each book sized by verse count) shows where you are; tap or drag it to jump. Book/chapter/verse pickers and arrow keys also work (Shift = 10 verses, PgUp/PgDn = 100).
- **Scoring** — `100 · e^(−d/1863)` (75% of the book off ≈ 7 points), where `d` is the number of verses between your guess and the nearest verse of the passage (0 if you land inside it), with floors of 90 for the right chapter and 70 for the right book. Tune `CURVE_SCALE`, `CURVE_SHAPE` and the floors in `game.js`.
- **Practice** — unlimited random rounds after you finish the daily set.

## Data

`data/bom.js` is generated from [bcbooks/scriptures-json](https://github.com/bcbooks/scriptures-json):

```sh
curl -sSLo book-of-mormon.json https://raw.githubusercontent.com/bcbooks/scriptures-json/master/book-of-mormon.json
python3 tools/build_data.py book-of-mormon.json
```

`data/fame.js` holds per-verse General Conference citation counts from the [BYU Scripture Citation Index](https://scriptures.byu.edu):

```sh
python3 tools/fetch_citations.py 2005 2026   # one request per chapter, ~5 minutes
python3 tools/build_fame.py
```
