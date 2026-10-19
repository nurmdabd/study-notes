# Repo rules for Claude

This repo is public and served at <https://nurmdabd.github.io/study-notes/> (GitHub Pages, from `main`, root folder).

- **Share copies only.** The PDFs here are the print-locked share copies (`*-pack_share.pdf`) from `nurmdabd/academic-material`. Never add a screen copy, a print copy, sources, `.tex` or figures.
- **Publish with the tool:** `python3 tools/publish.py ../academic-material` (the repos cloned side by side; in a cloud session they are under `/home/user/`) copies every pack's share copy and rewrites `items` in `catalogue.json`. Do not edit `items` by hand. A new subject goes into `subjects` first (folder, code, short name, title).
- **`catalogue.json` → `site`** holds the WhatsApp number and `order_endpoint` (the Apps Script web app URL). Its price note and options are only the first values of the sheet's **Settings** tab and the fallback when the web app does not answer; the live prices and options come from the web app (`?action=settings`), set on `admin.html` with the admin key. Options are names or `{name, available, price}`.
- **Publishing never touches the admin settings** (they live in the user's sheet). Hidden packs, subject order and paper order are keyed by subject code and pack ID (`<code>-<session>-pack`), so keep IDs stable: a new subject or a new paper stays hidden (not in `known_subjects` / `known_items`) until the user ticks and saves it on the admin page (it shows there with a New badge), so tell them what you published.
- **`apps-script/Code.gs`** lives in the user's Google Sheet; this file is its source copy. After changing it, tell the user to paste it again and redeploy with **Manage deployments → New version** (same URL). See `SETUP.md`.
- **Test the script** with `node tests/apps-script.test.js` (a mock of the Google services; extend it for new behaviour) before handing it over (the user pastes and redeploys it by hand, so a bug costs a round). The page and the admin page: in a browser, with the web app mocked.
- Pushing to `main` publishes the site, and the user has agreed to that for this repo. Check the page (`index.html`) in a browser before pushing a change to it.
