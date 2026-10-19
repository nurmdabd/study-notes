# Setting up the print orders

You do this once. It takes about 15 minutes. Afterwards, new packs reach the website automatically.

```
catalogue.json (this repo) ──► the order page (website) ──► Apps Script web app ──► Google Sheet "Orders"
        │                                                         ▲
        └── copied every hour into the sheet's Catalogue tab ─────┘ (orders are checked and priced against it)
```

Every order goes into the **Orders** tab, one row per pack.

## 1. Turn on the website (GitHub Pages)

1. Open <https://github.com/nurmdabd/study-notes/settings/pages>.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, **Branch** to `main` and the folder to `/ (root)`, then **Save**.
3. After a minute or two the site is live at <https://nurmdabd.github.io/study-notes/>.
4. Check that <https://nurmdabd.github.io/study-notes/catalogue.json> opens. The Apps Script reads that address.

## 2. Make the order sheet and the script

1. Go to <https://sheets.new> and name the new spreadsheet **Print orders**.
2. Open **Extensions → Apps Script**.
3. Delete what is in `Code.gs`, paste the whole of [`apps-script/Code.gs`](apps-script/Code.gs) and press **Save** (💾).
4. In the toolbar's function list choose **setup**, then press **Run**.
   - Google asks for permission: **Review permissions → your account → Advanced → Go to (unsafe) → Allow**. ("Unsafe" only means Google has not reviewed your own script.)
   - The script asks to: manage your spreadsheets, connect to an external service (to read `catalogue.json`), send email as you (the new-order emails), and run when you're not there (the hourly copy of the catalogue).
5. When it finishes, the **Execution log** shows your admin key.

`setup` makes:

| Tab | What it is |
|---|---|
| **Orders** | Every order, one row per pack: the print type, copies, price, phone numbers, payment and a **Status** dropdown (New → Price sent → Paid → Printed → Delivered, or Cancelled), each status with its own colour. |
| **Summary** | What to print (copies of each pack and print type still to print), copies by department and batch, and the number of order lines per status. |
| **Catalogue** | The packs, copied from the website every hour. |
| **Settings** | Prices and order options; change them on the admin page. |

## 3. Turn on the web orders (deploy the web app)

1. In the Apps Script editor: **Deploy → New deployment**.
2. Press the gear next to *Select type* and choose **Web app**.
3. Set **Execute as** to *Me* and **Who has access** to *Anyone*, then **Deploy**.
4. Copy the **Web app URL**, which ends in `/exec`. Open it once in a browser: it should show `{"ok":true,...}`.
5. Send me (Claude) the web app URL. I put it in `catalogue.json` (`order_endpoint`), and the page's **Send order** button appears.

## Updating the script

When `apps-script/Code.gs` changes:

1. In the Apps Script editor, replace all of `Code.gs` with the new file and **Save**.
2. Run **upgrade** when the change notes say so (it is safe to run any time). It brings the Orders, Summary and Settings tabs up to date and shows the admin key.
3. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.** The web app URL stays the same; a *New deployment* would get a new one.

**Retiring the old Google Form** (once, for a sheet set up while the script still made a form): after updating the script, run **removeForm**. It stops the form's trigger, unlinks the form from the sheet and moves it to Drive's trash (restorable for 30 days). Google asks once more for permission, this time to use Drive. Orders already in the sheet stay; the **Form Responses 1** tab stays too, and you can delete it.

## The admin page

<https://nurmdabd.github.io/study-notes/admin.html> sets the prices and order options:

- taking orders on or off
- the price note, and whether the page shows prices
- print types with a price per page each (black and white, colour, or a mix such as "Colour figures, rest B&W")
- binding options with their prices
- pickup and payment options, with the number for each mobile-banking method (for example bKash: 01XXXXXXXXX, personal, Send Money), shown on the page with the amount to send
- whether to ask for department and batch
- the order of the subjects, and which subjects and papers are shown (a hidden one is left off the page and can't be ordered)

An option you untick as *available* stays saved but is hidden. On saving, the order page uses the new settings at once.

- It asks for the **admin key**: in the Apps Script editor run **showAdminKey** and copy the key from the Execution log. Keep it private; run **newAdminKey** to replace it.
- The key is stored only in the script's properties, never in this repo, and checked by the script on every load and save; `admin.html` itself is public but does nothing without it.
- After 10 wrong keys in 10 minutes the admin page is locked for 10 minutes.
- The settings are stored in the sheet's **Settings** tab (one row per setting, the value as JSON). Editing that tab by hand also works, but the admin page checks your input.

## Day to day

- Every order emails you, with the order ID, the packs and their prices. To stop the emails, set `NOTIFY_BY_EMAIL: false` at the top of the script.
- Move the **Status** along as the order goes. Every order from the page shows its order ID (SN-yymmdd-XXXX), and a student who also messages you on WhatsApp sends the same ID.
- **Summary → To print** tells you how many copies of each pack to print in one go.
- To filter by subject, department or batch without disturbing others: **Data → Create filter view** on Orders.

## Changing things

| To change | Do this |
|---|---|
| Add or update packs | I run `tools/publish.py` and push. The page updates at once, and the sheet's Catalogue tab within the hour (or run **syncNow**). A new paper of a shown subject appears at once, newest first. A **new subject** stays hidden: on the admin page it is marked **New**; place it with ↑ ↓, tick it and save. |
| Prices, print types, price note, binding, pickup or payment options, pausing orders, department and batch, subject order, hiding a subject or paper | The admin page. The page follows at once. |
| WhatsApp number | `site.whatsapp` in `catalogue.json` (I can do it). |
| A pack replaced by a new version | I run `tools/publish.py` and push: the page count, the page's prices and the download change at once, the sheet's Catalogue tab within the hour (or run **syncNow**). Orders already placed keep the page count and price they were made with. |
