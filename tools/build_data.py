"""Convert bcbooks/scriptures-json book-of-mormon.json into the compact data file the game loads.

Usage:
    curl -sSLo book-of-mormon.json https://raw.githubusercontent.com/bcbooks/scriptures-json/master/book-of-mormon.json
    python3 tools/build_data.py book-of-mormon.json
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "bom.js"


def main(src):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    books = []
    for book in data["books"]:
        chapters = [[v["text"].strip() for v in ch["verses"]] for ch in book["chapters"]]
        books.append({"name": book["book"], "chapters": chapters})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # A plain script (not JSON + fetch) so index.html also works when opened from file://
    payload = json.dumps(books, ensure_ascii=False, separators=(",", ":"))
    OUT.write_text(f"window.BOM_DATA={payload};\n", encoding="utf-8")

    verses = sum(len(c) for b in books for c in b["chapters"])
    print(f"wrote {OUT} ({len(books)} books, {verses} verses, {OUT.stat().st_size // 1024} KiB)")


if __name__ == "__main__":
    main(sys.argv[1])
