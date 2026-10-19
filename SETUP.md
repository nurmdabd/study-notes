# Setting up the print orders

You do this once. It takes about 15 minutes. Afterwards, new packs reach the website and the form automatically.

```
catalogue.json (this repo) ──► the order page (website) ──► Apps Script web app ─┐
        │                                                                            ├─► Google Sheet "Orders"
        └── read every hour by the Apps Script ──► the Google Form ─────────────────┘
```

Both ways of ordering write into the same **Orders** tab, one row per pack.

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
   - The script asks to: manage your spreadsheets and forms, connect to an external service (to read `catalogue.json`), send email as you (the new-order emails), and run when you're not there (the triggers).
5. When it finishes, open **Execution log**: it shows the form's link to share and its edit link.

`setup` makes:

| Tab or file | What it is |
|---|---|
| **Orders** | Every order, one row per pack, with a **Status** dropdown: New → Price sent → Paid → Printed → Delivered (or Cancelled). Each status has its own colour. |
| **Summary** | What to print (copies of each pack still to print), copies by department and batch, and the number of order lines per status. |
| **Catalogue** | The packs, copied from the website every hour, with a **pre-filled form link** for each pack (it opens the form with that pack ticked). |
| **Form Responses 1** | Google's own copy of the form answers. Leave it alone; the script copies each answer into **Orders**. |
| **The Google Form** | Your details, then one tick-box question per subject, then printing and payment. |

## 3. Turn on the web orders (deploy the web app)

1. In the Apps Script editor: **Deploy → New deployment**.
2. Press the gear next to *Select type* and choose **Web app**.
3. Set **Execute as** to *Me* and **Who has access** to *Anyone*, then **Deploy**.
4. Copy the **Web app URL**, which ends in `/exec`. Open it once in a browser: it should show `{"ok":true,...}`.
5. Send me (Claude) the web app URL and the form's share link. I put them in `catalogue.json` (`order_endpoint` and `google_form`), and the page's **Send order** and **Use the Google Form instead** buttons appear.

When the script changes later, use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. That keeps the same URL; a *New deployment* would get a new one.

## Updating the script

When `apps-script/Code.gs` changes:

1. In the Apps Script editor, replace all of `Code.gs` with the new file and **Save**.
2. If the change notes say so, run the function they name (for the October 2026 update: **upgrade**, once).
3. **Deploy → Manage deployments → ✏️ (edit) → Version: New version → Deploy.** The web app URL stays the same.

## The admin page

<https://nurmdabd.github.io/study-notes/admin.html> sets the prices and order options:

- taking orders on or off
- the price note
- the price per printed page and whether the page shows an estimate
- binding options with their prices
- pickup and payment options
- whether to ask for department and batch

An option you untick as *available* stays saved but is hidden. On saving, the order page and the Google Form use the new settings at once.

- It asks for the **admin key**: in the Apps Script editor run **showAdminKey** and copy the key from the Execution log. Keep it private; run **newAdminKey** to replace it.
- The settings are stored in the sheet's **Settings** tab (one row per setting, the value as JSON). Editing that tab by hand also works, but the admin page checks your input.
- After 10 wrong keys in 10 minutes the admin page is locked for 10 minutes.

## Day to day

- Every order emails you, with the order ID and the packs. To stop the emails, set `NOTIFY_BY_EMAIL: false` at the top of the script.
- Message the student on WhatsApp with the price, then move the **Status** along. Every order from the page shows its order ID (SN-yymmdd-XXXX), and a student who also messages you on WhatsApp sends the same ID.
- **Summary → To print** tells you how many copies of each pack to print in one go.
- To filter by subject, department or batch without disturbing others: **Data → Create filter view** on Orders.

## Changing things

| To change | Do this |
|---|---|
| Add or update packs | I run `tools/publish.py` and push. The page updates at once, and the form within the hour (or run **syncNow**). |
| Price, price note, binding, pickup or payment options, pausing orders, asking for department and batch | The admin page. The page and the form follow at once. |
| WhatsApp number | `site.whatsapp` in `catalogue.json` (I can do it). |
| Ask for department and batch in the Google Form | Besides the admin page, add a dropdown question titled exactly **Department** (or **Batch**) on the form's first page. |
