# Study notes

**Website:** <https://nurmdabd.github.io/study-notes/>

Free shared copies of Nur Mohammad's exam packs (EEE): each past paper fully solved, with its formula sheet. Download them free, or order a printed copy at printing cost.

The website lists every pack with its download link; `catalogue.json` holds the same list.

## How this repo works

- `catalogue.json` lists the packs. Its `site` part holds the WhatsApp number, the order endpoint, and the first values of the settings. Its `items` part is written by `tools/publish.py`.
- `tools/publish.py [path/to/academic-material]` copies each pack's share copy (`<subject>/past-papers/pdf/<session>-pack_share.pdf`) here as `<subject>/<short>-<session>-pack.pdf` (for example `EEE475-RF/RF-2019-20-pack.pdf`) and rebuilds `items`. Run it after a pack is rebuilt or added, then commit and push.
- `admin.html` sets the prices, print types (black and white, colour), order options and which subjects and papers are shown (admin key needed); they live in the order sheet's Settings tab.
- `index.html` is the order page, and reads `catalogue.json` and the settings from the web app. Link to one pack with `?item=<id>`, for example `?item=EEE475-2019-20-pack`: the page opens with that pack in the order.
- `apps-script/Code.gs` is the Google Apps Script behind the orders: the web app the page sends orders to, and the Google Form it makes and keeps in step with the catalogue. Both write into one Google Sheet. Setup: [SETUP.md](SETUP.md).

The sources, the screen and print copies, and the other documents live in `nurmdabd/academic-material`.
