#!/usr/bin/env python3
"""Copy the share copies of the exam packs from academic-material into this site and rebuild catalogue.json.

Usage:  python3 tools/publish.py [path/to/academic-material]   (default: ../academic-material)

catalogue.json keeps its "site" and "subjects" parts as they are; only "items" is rebuilt.
Each exam pack's share copy (<subject>/past-papers/<session>/pdf/<session>-pack_share.pdf) is copied to
<subject>/<short>-<session>-pack.pdf here, <short> being the folder's short name (EEE475-RF -> RF-2019-20-pack.pdf),
so a downloaded file says its subject. A Bangla pack (<session>-pack_Bangla_share.pdf) is published beside it as
<short>-<session>-pack-Bangla.pdf, its own item with the ID <code>-<session>-pack-bn ("Exam pack (Bangla)").
A session's standalone question paper (<session>-question-paper_share.pdf) becomes <short>-<session>-question-paper.pdf,
its own item with the ID <code>-<session>-question-paper ("Question paper"), listed after that session's packs. A new ID
stays hidden on the site until it is ticked on the admin page.
PDFs left over from an older name are removed. "pages" is the page count of the print copy, which is what gets printed.
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
published = set()
# the English pack of a session first, its Bangla pack right after
for share in sorted(SRC.glob("EEE*/past-papers/*/pdf/*-pack*_share.pdf"),
                    key=lambda p: (str(p.parent), p.name.replace("_Bangla", ""), "_Bangla" in p.name)):
    folder = share.parts[-5]   # <subject>/past-papers/<session>/pdf/<file>
    m = re.match(r"(\d{4}-\d{2})-pack(_Bangla)?_share\.pdf$", share.name)
    if not m:
        continue
    session, bangla = m.group(1), bool(m.group(2))
    lang = "_Bangla" if bangla else ""
    if folder not in subjects:
        sys.exit(f"{folder} is not listed under 'subjects' in catalogue.json; add it first.")
    printed = share.with_name(f"{session}-pack{lang}_print.pdf")
    pages = len(PdfReader(printed if printed.exists() else share).pages)
    dest = SITE / folder / f"{folder.split('-', 1)[1]}-{session}-pack{'-Bangla' if bangla else ''}.pdf"
    dest.parent.mkdir(exist_ok=True)
    shutil.copy2(share, dest)
    published.add(dest)
    code = subjects[folder]["code"]
    items.append({
        "id": f"{code}-{session}-pack" + ("-bn" if bangla else ""),
        "subject": code,
        "session": session,
        "document": "Exam pack (Bangla)" if bangla else "Exam pack",
        "detail": "Past-paper solution + formula sheet",
        "pages": pages,
        "file": f"{folder}/{dest.name}",
        "printable": True,
    })

# each session's standalone question paper, right after that session's packs
for share in sorted(SRC.glob("EEE*/past-papers/*/pdf/*-question-paper_share.pdf")):
    folder = share.parts[-5]
    session = share.name.split("-question-paper")[0]
    if folder not in subjects:
        sys.exit(f"{folder} is not listed under 'subjects' in catalogue.json; add it first.")
    printed = share.with_name(f"{session}-question-paper_print.pdf")
    dest = SITE / folder / f"{folder.split('-', 1)[1]}-{session}-question-paper.pdf"
    dest.parent.mkdir(exist_ok=True)
    shutil.copy2(share, dest)
    published.add(dest)
    code = subjects[folder]["code"]
    item = {
        "id": f"{code}-{session}-question-paper",
        "subject": code,
        "session": session,
        "document": "Question paper",
        "detail": "The paper alone, without solutions",
        "pages": len(PdfReader(printed if printed.exists() else share).pages),
        "file": f"{folder}/{dest.name}",
        "printable": True,
    }
    last = max((i for i, it in enumerate(items) if it["subject"] == code and it["session"] == session), default=len(items) - 1)
    items.insert(last + 1, item)

for old in SITE.glob("EEE*/*.pdf"):
    if old not in published:
        old.unlink()
        print(f"  removed {old.relative_to(SITE)}")

catalogue["items"] = items
CAT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(items)} items published from {SRC}")
for it in items:
    print(f"  {it['id']:<25} {it['pages']:>4} pages  {it['file']}")
