#!/usr/bin/env python3
"""Copy the share copies of the exam packs from academic-material into this site and rebuild catalogue.json.

Usage:  python3 tools/publish.py [path/to/academic-material]   (default: ../academic-material)

catalogue.json keeps its "site" and "subjects" parts as they are; only "items" is rebuilt.
Each exam pack's share copy (<subject>/past-papers/pdf/<session>-pack_share.pdf) is copied to
<subject>/<session>-pack.pdf here. "pages" is the page count of the print copy, which is what gets printed.
A subject folder not yet listed under "subjects" stops the script, so its title is added by hand first.
"""
import json
import re
import shutil
import sys
from pathlib import Path

from pypdf import PdfReader

SITE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SITE.parent / "academic-material"
CAT = SITE / "catalogue.json"

catalogue = json.loads(CAT.read_text(encoding="utf-8"))
subjects = {s["folder"]: s for s in catalogue["subjects"]}

items = []
for share in sorted(SRC.glob("EEE*/past-papers/pdf/*-pack_share.pdf")):
    folder = share.parts[-4]
    session = re.match(r"(\d{4}-\d{2})-pack_share\.pdf$", share.name).group(1)
    if folder not in subjects:
        sys.exit(f"{folder} is not listed under 'subjects' in catalogue.json; add it first.")
    printed = share.with_name(f"{session}-pack_print.pdf")
    pages = len(PdfReader(printed if printed.exists() else share).pages)
    dest = SITE / folder / f"{session}-pack.pdf"
    dest.parent.mkdir(exist_ok=True)
    shutil.copy2(share, dest)
    code = subjects[folder]["code"]
    items.append({
        "id": f"{code}-{session}-pack",
        "subject": code,
        "session": session,
        "document": "Exam pack",
        "detail": "Past-paper solution + formula sheet",
        "pages": pages,
        "file": f"{folder}/{session}-pack.pdf",
        "printable": True,
    })

catalogue["items"] = items
CAT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(items)} packs published from {SRC}")
for it in items:
    print(f"  {it['id']:<22} {it['pages']:>4} pages  {it['file']}")
