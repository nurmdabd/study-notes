# Repo rules for Claude

This repo is public and served at <https://nurmdabd.github.io/study-notes/> (GitHub Pages, from `main`, root folder).

- **Share copies only.** The PDFs here are the print-locked share copies (`*-pack_share.pdf`) from `nurmdabd/academic-material`. Never add a screen copy, a print copy, sources, `.tex` or figures.
- **Publish with the tool:** `python3 tools/publish.py /home/user/academic-material` copies every pack's share copy and rewrites `items` in `catalogue.json`. Do not edit `items` by hand. A new subject goes into `subjects` first (folder, code, short name, title).
- **`catalogue.json` → `site`** holds the WhatsApp number, `order_endpoint` (the Apps Script web app URL), `google_form`, the price note and the order options. The page reads it directly.
- **`apps-script/Code.gs`** lives in the user's Google Sheet; this file is its source copy. After changing it, tell the user to paste it again and redeploy with **Manage deployments → New version** (same URL). See `SETUP.md`.
- Pushing to `main` publishes the site, and the user has agreed to that for this repo. Check the page (`index.html`) in a browser before pushing a change to it.
