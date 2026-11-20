"""Fetch General Conference citation counts for every Book of Mormon chapter from the
BYU Scripture Citation Index (https://scriptures.byu.edu), one polite request per chapter.

Writes data/citations-raw.json: {"Alma 32": {"21": 40, "1-43": 5, ...}, ...}, where each key is a
verse or verse range as the index lists it and each value is how many talks cited it.

Usage:
    python3 tools/fetch_citations.py [START_YEAR] [END_YEAR]   # default: 2005 to this year
"""
import datetime
import html
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "citations-raw.json"
BASE = "https://scriptures.byu.edu/citation_index/citation_ajax/Any/{start}/{end}/G/s/f/{book}/{chapter}"

# Index book ids and chapter counts for the Book of Mormon
BOOKS = [
    ("1 Nephi", 205, 22), ("2 Nephi", 206, 33), ("Jacob", 207, 7), ("Enos", 208, 1), ("Jarom", 209, 1),
    ("Omni", 210, 1), ("Words of Mormon", 211, 1), ("Mosiah", 212, 29), ("Alma", 213, 63),
    ("Helaman", 214, 16), ("3 Nephi", 215, 30), ("4 Nephi", 216, 1), ("Mormon", 217, 9),
    ("Ether", 218, 15), ("Moroni", 219, 10),
]
# Matches entries like: getFilter('213', '32', '1-43', '') ... Alma 32:1-43 [5]
ENTRY = re.compile(r"getFilter\('\d+', '(\d+)', '([\d,\- ]+)', ''\)\">(.*?)</a>", re.S)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "BoMTap citation fetch (one-time, 1 req/s)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def main():
    year = datetime.date.today().year
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 2005
    end = int(sys.argv[2]) if len(sys.argv) > 2 else year

    out = {}
    for name, book_id, chapters in BOOKS:
        for ch in range(1, chapters + 1):
            page = html.unescape(fetch(BASE.format(start=start, end=end, book=book_id, chapter=ch)))
            counts = {}
            for c, verses, label in ENTRY.findall(page):
                m = re.search(r"\[(\d+)\]", label)
                if c == str(ch) and m:
                    counts[verses.replace(" ", "")] = int(m.group(1))
            out[f"{name} {ch}"] = counts
            print(f"{name} {ch}: {sum(counts.values())} citations", flush=True)
            time.sleep(1)

    OUT.write_text(json.dumps({"source": "BYU Scripture Citation Index", "corpus": "General Conference",
                               "years": [start, end], "chapters": out}, indent=1), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
