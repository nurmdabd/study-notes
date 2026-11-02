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
A subject's question analysis (<subject>/past-papers/analysis/) becomes <short>-question-analysis.pdf, its data
<short>-question-analysis.json, and one item with the ID <code>-question-analysis, listed last for the subject; its
"page" opens analysis.html. PDFs left over from an older name are removed. "pages" is the page count of the print copy, which is what gets printed.
A subject folder not yet listed under "subjects" stops the script, so its title is added by hand first.
Each item's "updated" is when its PDF last changed: now if the share copy's hash differs from the "source" stored in the
item, otherwise the old value, or for an item without one the file's last commit here.
Every site PDF gets a short title for the browser tab ("VLSI 2019-20 Exam Pack"); the share copy opens without a password,
so it is read with the empty password, retitled and locked again with the same permissions.
"""
import filecmp
import hashlib
import json
import re
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pypdf import PdfReader, PdfWriter

SITE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else SITE.parent / "academic-material"
CAT = SITE / "catalogue.json"

catalogue = json.loads(CAT.read_text(encoding="utf-8"))
subjects = {s["folder"]: s for s in catalogue["subjects"]}
old_updated = {it["file"]: it["updated"] for it in catalogue["items"] if it.get("updated")}
old_source = {it["file"]: it["source"] for it in catalogue["items"] if it.get("source")}
NOW = datetime.now(timezone(timedelta(hours=6))).isoformat(timespec="minutes")


def publish(share, dest, title):
    """Copy a share PDF to dest with a short title, unless it is unchanged. Return (updated, source hash)."""
    rel = dest.relative_to(SITE).as_posix()
    source = hashlib.sha256(share.read_bytes()).hexdigest()[:16]
    same = old_source[rel] == source if rel in old_source else dest.exists() and filecmp.cmp(share, dest, shallow=False)
    updated = NOW
    if same:
        updated = old_updated.get(rel) or subprocess.run(["git", "log", "-1", "--format=%cI", "--", rel], cwd=SITE,
                                                         capture_output=True, text=True).stdout.strip() or NOW
        if rel in old_source:
            return updated, source
    reader = PdfReader(share)
    reader.decrypt("")
    flags = reader.trailer["/Encrypt"]["/P"]
    writer = PdfWriter(clone_from=reader)
    writer.add_metadata({"/Title": title})
    writer.encrypt(user_password="", owner_password=secrets.token_hex(16), permissions_flag=flags & 0xFFFFFFFF, algorithm="AES-128")
    writer.write(dest)
    return updated, source


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
    updated, source = publish(share, dest, f"{folder.split('-', 1)[1]} {session} Exam Pack" + (" (Bangla)" if bangla else ""))
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
        "updated": updated,
        "source": source,
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
    updated, source = publish(share, dest, f"{folder.split('-', 1)[1]} {session} Question Paper")
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
        "updated": updated,
        "source": source,
    }
    last = max((i for i, it in enumerate(items) if it["subject"] == code and it["session"] == session), default=len(items) - 1)
    items.insert(last + 1, item)

# each subject's question analysis: its share copy, and the data of the interactive page
for share in sorted(SRC.glob("EEE*/past-papers/analysis/pdf/*-question-analysis_share.pdf")):
    folder = share.parts[-5]
    if folder not in subjects:
        sys.exit(f"{folder} is not listed under 'subjects' in catalogue.json; add it first.")
    short, code = folder.split("-", 1)[1], subjects[folder]["code"]
    dest = SITE / folder / f"{short}-question-analysis.pdf"
    updated, source = publish(share, dest, f"{short} Question Analysis")
    published.add(dest)
    shutil.copy2(share.parents[1] / f"{code}-question-analysis.json", SITE / folder / f"{short}-question-analysis.json")
    printed = share.with_name(f"{code}-question-analysis_print.pdf")
    items.append({
        "id": f"{code}-question-analysis",
        "subject": code,
        "session": "All papers",
        "document": "Question analysis",
        "detail": "Topics, marks and formulas across the papers",
        "pages": len(PdfReader(printed if printed.exists() else share).pages),
        "file": f"{folder}/{dest.name}",
        "page": f"analysis.html?subject={code}",
        "printable": True,
        "updated": updated,
        "source": source,
    })

for old in SITE.glob("EEE*/*.pdf"):
    if old not in published:
        old.unlink()
        print(f"  removed {old.relative_to(SITE)}")

catalogue["items"] = items
CAT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(f"{len(items)} items published from {SRC}")
for it in items:
    print(f"  {it['id']:<25} {it['pages']:>4} pages  {it['file']}")
