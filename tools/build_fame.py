"""Turn data/citations-raw.json (from fetch_citations.py) into per-verse citation weights the game
uses to rank passage difficulty.

A citation of a short range credits each verse fully; longer ranges (e.g. a whole chapter) spread
their credit so they don't make every verse look famous.

Usage:
    python3 tools/build_fame.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "citations-raw.json"
BOM = ROOT / "data" / "bom.js"
OUT = ROOT / "data" / "fame.js"
FULL_CREDIT_SPAN = 4  # ranges up to this many verses credit every verse fully


def verses_in(spec):
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b or a) + 1))
    return out


def main():
    books = json.loads(re.sub(r"^window\.BOM_DATA=|;\s*$", "", BOM.read_text(encoding="utf-8")))
    raw = json.loads(RAW.read_text(encoding="utf-8"))

    weights = []
    for book in books:
        for c, chapter in enumerate(book["chapters"], 1):
            w = [0.0] * len(chapter)
            for spec, count in raw["chapters"].get(f"{book['name']} {c}", {}).items():
                vs = [v for v in verses_in(spec) if 1 <= v <= len(chapter)]
                share = count * min(1, FULL_CREDIT_SPAN / len(vs)) if vs else 0
                for v in vs:
                    w[v - 1] += share
            weights.extend(w)

    payload = json.dumps([round(x, 1) if x % 1 else int(x) for x in weights], separators=(",", ":"))
    start, end = raw["years"]
    OUT.write_text(
        f"// General Conference citations per verse, {start}-{end}, from the BYU Scripture Citation Index\n"
        f"window.BOM_CITES={payload};\n",
        encoding="utf-8",
    )
    cited = sum(1 for x in weights if x)
    print(f"wrote {OUT}: {len(weights)} verses, {cited} cited ({cited / len(weights):.0%})")


if __name__ == "__main__":
    main()
