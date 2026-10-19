/**
 * Print orders for https://nurmdabd.github.io/study-notes/
 *
 * The web order page sends each order here (doPost); it goes into the "Orders" tab, one row per
 * pack ordered.
 *
 * The list of packs lives in catalogue.json on the website. Every hour (and when you run syncNow)
 * the script copies it into the "Catalogue" tab, which orders are checked and priced against.
 *
 * Prices and order options live in the "Settings" tab. Change them on the admin page
 * (https://nurmdabd.github.io/study-notes/admin.html, with the key from showAdminKey) or in the tab.
 * The order page reads them from this web app, so a change shows at once.
 *
 * Setup: see SETUP.md. In short: paste this file, run setup once, deploy as a web app.
 */

const CONFIG = {
  CATALOGUE_URL: 'https://nurmdabd.github.io/study-notes/catalogue.json',
  NOTIFY_BY_EMAIL: true, // an email to you for every new order
  MAX_COPIES: 20,
};

const SHEETS = { orders: 'Orders', catalogue: 'Catalogue', summary: 'Summary', settings: 'Settings' };

const ORDER_HEADERS = [
  'Received', 'Order ID', 'Source', 'Name', 'Student ID', 'Department', 'Batch', 'WhatsApp',
  'Subject', 'Session', 'Document', 'Item ID', 'Copies', 'Pages', 'Binding', 'Pickup',
  'Payment', 'Transaction ID', 'Notes', 'Status', 'Price (BDT)', 'Print', 'Mobile',
];
const STATUS_COL = ORDER_HEADERS.indexOf('Status') + 1; // T
const STATUSES = ['New', 'Price sent', 'Paid', 'Printed', 'Delivered', 'Cancelled'];
const STATUS_COLOURS = {
  'New': '#fde68a', 'Price sent': '#bfdbfe', 'Paid': '#bbf7d0',
  'Printed': '#ddd6fe', 'Delivered': '#e5e7eb', 'Cancelled': '#fecaca',
};

// ---------------------------------------------------------------- setup

/** Run once from the editor: makes the tabs and the hourly trigger. Safe to run again. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  setupOrdersSheet_(ss);
  writeCatalogueSheet_(ss, fetchCatalogue_());
  setupSummarySheet_(ss);
  settings_(); // makes the Settings tab from catalogue.json the first time
  installTriggers_();
  showAdminKey();
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).');
}

/** Run any time to copy the catalogue into the Catalogue tab now (the hourly trigger does the same). */
function syncNow() {
  const cat = fetchCatalogue_();
  PropertiesService.getScriptProperties().setProperty('SITE_DEFAULTS',
    JSON.stringify({ department: cat.site.department.default, batch: cat.site.batch.default }));
  writeCatalogueSheet_(ss_(), cat);
}

/**
 * Run once to retire the Google Form (orders come only from the web page now): stops the form's
 * trigger, unlinks it from this sheet and moves it to Drive's trash. The orders and the
 * "Form Responses" tab stay; delete that tab yourself if you no longer want it.
 */
function removeForm() {
  const props = PropertiesService.getScriptProperties();
  installTriggers_(); // only the hourly catalogue copy is left
  const id = props.getProperty('FORM_ID');
  if (id) {
    try {
      const form = FormApp.openById(id);
      try { form.removeDestination(); } catch (e) { /* not linked */ }
      DriveApp.getFileById(id).setTrashed(true);
      Logger.log('The form is unlinked and in the trash (restore it from Drive within 30 days if needed).');
    } catch (e) {
      Logger.log('The form was already gone: ' + e.message);
    }
  }
  ['FORM_ID', 'PB_PACKS', 'PB_PRINTING', 'SUBJECT_ITEMS', 'CHOICE_MAP'].forEach(k => props.deleteProperty(k));
  writeCatalogueSheet_(ss_(), fetchCatalogue_()); // without the form-link column
}

/**
 * Run once after updating the script (safe to run again): brings the Orders and Summary tabs and the
 * Settings tab up to date, and shows the admin key.
 */
function upgrade() {
  const ss = ss_();
  ss.getSheetByName(SHEETS.orders).getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  writeSettings_(settings_()); // adds new settings with their defaults
  setupSummarySheet_(ss);
  syncNow();
  showAdminKey();
}

/** Shows the admin page's key in the Execution log (makes one the first time). Keep it private. */
function showAdminKey() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('ADMIN_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    props.setProperty('ADMIN_KEY', key);
  }
  Logger.log('Admin key: ' + key + '   (admin page: https://nurmdabd.github.io/study-notes/admin.html)');
}

/** Run to make a new admin key, for example if the old one was seen by someone else. */
function newAdminKey() {
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_KEY');
  showAdminKey();
}

/** The order spreadsheet; opened by ID because triggers and the web app have no active sheet. */
function ss_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncNow').timeBased().everyHours(1).create();
}

// ---------------------------------------------------------------- catalogue

function fetchCatalogue_() {
  const res = UrlFetchApp.fetch(CONFIG.CATALOGUE_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('Could not read the catalogue (' + res.getResponseCode() + '): ' + CONFIG.CATALOGUE_URL);
  }
  const cat = JSON.parse(res.getContentText());
  const base = CONFIG.CATALOGUE_URL.replace(/catalogue\.json$/, '');
  const subjects = {};
  cat.subjects.forEach(s => { subjects[s.code] = s; });
  cat.items.forEach(it => {
    it.url = base + it.file;
    it.subjectInfo = subjects[it.subject];
  });
  cat.subjectMap = subjects;
  return cat;
}

function writeCatalogueSheet_(ss, cat) {
  const sh = ss.getSheetByName(SHEETS.catalogue) || ss.insertSheet(SHEETS.catalogue);
  const header = ['Item ID', 'Subject', 'Short', 'Title', 'Session', 'Document', 'Pages', 'Printable', 'Download'];
  const rows = cat.items.map(it => [
    it.id, it.subject, it.subjectInfo.short, it.subjectInfo.title, it.session, it.document,
    it.pages, it.printable ? 'yes' : 'no', it.url,
  ]);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
  if (rows.length) sh.getRange(2, 1, rows.length, header.length).setValues(rows);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 8);
}

/** Item details by ID, read from the Catalogue tab (so an order does not wait for the website). */
function catalogueById_() {
  const sh = ss_().getSheetByName(SHEETS.catalogue);
  const map = {};
  if (!sh || sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 8).getValues().forEach(r => {
    map[r[0]] = { id: r[0], subject: r[1], session: r[4], document: r[5], pages: r[6], printable: r[7] === 'yes' };
  });
  return map;
}

// ---------------------------------------------------------------- the web order page

// ---------------------------------------------------------------- settings

/*
 * The Settings tab: one row per setting, the value as JSON. Edit it on the admin page; by hand only
 * with care. Options are lists of {name, available} (binding also has price, in BDT per copy).
 */
const SETTING_KEYS = ['accepting_orders', 'price_note', 'show_estimate', 'print',
  'binding', 'pickup', 'payment', 'department', 'batch', 'hidden', 'subject_order', 'item_order', 'known_subjects', 'known_items'];
const PRICE_NOTE = 'At printing cost. The price can vary slightly with paper and shop rates\u2014check each card for the exact price.';
const OLD_PRICE_NOTES = [
  "Printing cost only, no profit. I'll confirm the price on WhatsApp before printing.",
  "At printing cost, no profit. The price can move a little with paper and printing costs, so I'll confirm it on WhatsApp before printing.",
];
const SETTING_NOTES = {
  accepting_orders: 'true or false. false pauses ordering on the page.',
  price_note: 'The price line shown on the order page.',
  show_estimate: 'true or false: show the prices on the order page (on each pack and for the order).',
  print: 'List of {"name", "price_per_page" (BDT per printed page side), "available"}, e.g. black and white, colour.',
  hidden: '{"subjects": [subject codes], "items": [pack IDs]} hidden from the page (and not orderable).',
  subject_order: 'Subject codes in the order the page lists them; subjects not named follow in catalogue order.',
  item_order: '{subject code: [pack IDs]} for subjects whose papers are not newest first; packs not named come first, newest first.',
  known_subjects: 'Subject codes already seen on the admin page. A subject not listed (a new one) stays hidden until it is saved there.',
  known_items: 'Pack IDs already seen on the admin page. A pack not listed (a new paper) stays hidden until it is saved there.',
  binding: 'List of {"name", "price" (BDT per copy), "available"}.',
  pickup: 'List of {"name", "available"}.',
  payment: 'List of {"name", "details" (number and how to send, shown when chosen), "available"}.',
  department: '{"ask": true/false, "default", "options": [...]}',
  batch: '{"ask": true/false, "default", "options": [...]}',
};

function defaultSettings_() {
  let site = {};
  try { site = fetchCatalogue_().site; } catch (e) { /* the website is down: plain defaults */ }
  // catalogue options are names, or {name, available, price}
  const list = (names, extra) => (names || []).map(n =>
    Object.assign({ available: true }, extra || {}, typeof n === 'string' ? { name: n } : n));
  return {
    accepting_orders: true,
    price_note: site.price_note || PRICE_NOTE,
    show_estimate: false,
    print: [{ name: 'Black and white', price_per_page: 0, available: true },
      { name: 'Colour', price_per_page: 0, available: false }],
    hidden: { subjects: [], items: [] },
    subject_order: [],
    item_order: {},
    binding: list(site.binding || ['Stapled'], { price: 0 }),
    pickup: list(site.pickup || ['On campus']),
    payment: list(site.payment || ['Cash at pickup', 'bKash', 'Nagad']),
    department: site.department || { ask: false, default: 'EEE', options: ['EEE'] },
    batch: site.batch || { ask: false, default: '', options: [] },
  };
}

/** All settings, read from the Settings tab (made from the defaults the first time). */
function settings_() {
  const ss = ss_();
  let sh = ss.getSheetByName(SHEETS.settings);
  if (!sh) {
    sh = ss.insertSheet(SHEETS.settings);
    writeSettings_(defaultSettings_());
    return settings_();
  }
  const out = { accepting_orders: true, show_estimate: false }; // if a row was deleted
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(([k, v]) => {
      if (!k) return;
      try { out[k] = JSON.parse(v); } catch (e) { out[k] = v; }
    });
  }
  // settings older than this script: one price per page became the print types
  if (!Array.isArray(out.print)) {
    out.print = [{ name: 'Black and white', price_per_page: Number(out.price_per_page) || 0, available: true },
      { name: 'Colour', price_per_page: 0, available: false }];
  }
  delete out.price_per_page;
  if (!out.hidden) out.hidden = { subjects: [], items: [] };
  if (!Array.isArray(out.subject_order)) out.subject_order = [];
  if (!out.item_order || typeof out.item_order !== 'object' || Array.isArray(out.item_order)) out.item_order = {};
  if (OLD_PRICE_NOTES.includes(out.price_note)) out.price_note = PRICE_NOTE;
  // the subjects and packs there are when these settings first appear count as seen; later ones start hidden
  if (!Array.isArray(out.known_subjects) || !Array.isArray(out.known_items)) {
    try {
      const cat = fetchCatalogue_();
      if (!Array.isArray(out.known_subjects)) out.known_subjects = cat.subjects.map(s => s.code);
      if (!Array.isArray(out.known_items)) out.known_items = cat.items.map(it => it.id);
      writeSettings_(out);
    } catch (e) { // the website did not answer: hide nothing, decide next time
      if (!Array.isArray(out.known_subjects)) out.known_subjects = null;
      if (!Array.isArray(out.known_items)) out.known_items = null;
    }
  }
  return out;
}

function writeSettings_(st) {
  const sh = ss_().getSheetByName(SHEETS.settings) || ss_().insertSheet(SHEETS.settings);
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value (JSON)', 'What it is']])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  const rows = SETTING_KEYS.map(k => [k, JSON.stringify(st[k]), SETTING_NOTES[k]]);
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.getRange(2, 2, rows.length, 1).setNumberFormat('@').setWrap(true);
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 420); sh.setColumnWidth(3, 340);
}

/** What the order page may see: only available options, no sheet links. */
function publicSettings_(st) {
  const avail = l => (l || []).filter(o => o.available);
  return {
    accepting_orders: !!st.accepting_orders, price_note: st.price_note,
    show_estimate: !!st.show_estimate,
    print: avail(st.print).map(o => ({ name: o.name, price_per_page: Number(o.price_per_page) || 0 })),
    binding: avail(st.binding).map(o => ({ name: o.name, price: Number(o.price) || 0 })),
    hidden: st.hidden, subject_order: st.subject_order || [], item_order: st.item_order || {},
    known_subjects: Array.isArray(st.known_subjects) ? st.known_subjects : null,
    known_items: Array.isArray(st.known_items) ? st.known_items : null,
    pickup: avail(st.pickup).map(o => o.name), payment: avail(st.payment).map(o => o.name),
    payment_details: Object.fromEntries(avail(st.payment).filter(o => o.details).map(o => [o.name, String(o.details)])),
    department: st.department, batch: st.batch,
  };
}

/** Checks a settings object from the admin page; returns '' or what is wrong. */
function checkSettings_(st) {
  const isList = l => Array.isArray(l) && l.every(o => o && typeof o.name === 'string' && o.name.trim());
  if (typeof st.price_note !== 'string') return 'The price note is missing.';
  if (!isList(st.print) || st.print.some(o => !(Number(o.price_per_page) >= 0))) return 'Every print type needs a name and a price of 0 or more.';
  if (!st.print.some(o => o.available)) return 'At least one print type must be available.';
  if (!st.hidden || !Array.isArray(st.hidden.subjects) || !Array.isArray(st.hidden.items)) return 'The hidden list is malformed.';
  if (st.subject_order && !Array.isArray(st.subject_order)) return 'The subject order is malformed.';
  if (!Array.isArray(st.known_subjects) || !Array.isArray(st.known_items)) return 'The list of seen subjects and papers is missing (reload the admin page).';
  if (st.item_order && (typeof st.item_order !== 'object' || Array.isArray(st.item_order) ||
    Object.values(st.item_order).some(v => !Array.isArray(v)))) return 'The paper order is malformed.';
  for (const k of ['binding', 'pickup', 'payment']) {
    if (!isList(st[k])) return 'Every ' + k + ' option needs a name.';
    if (!st[k].some(o => o.available)) return 'At least one ' + k + ' option must be available.';
  }
  for (const k of ['department', 'batch']) {
    const d = st[k];
    if (!d || !Array.isArray(d.options)) return k + ': the options are missing.';
    if (d.ask && !d.options.length) return k + ': add options, or stop asking for it.';
  }
  return '';
}

/** Hidden: its subject or the pack was unticked on the admin page, or the subject or pack is new (not yet seen there). */
function isHidden_(st, it) {
  const h = st.hidden || { subjects: [], items: [] };
  return h.subjects.includes(it.subject) || h.items.includes(it.id) ||
    (Array.isArray(st.known_subjects) && !st.known_subjects.includes(it.subject)) ||
    (Array.isArray(st.known_items) && !st.known_items.includes(it.id));
}

/** A wrong admin key is answered slowly, and ten wrong keys in ten minutes lock the admin out for a while. */
function checkAdminKey_(key) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= 10) return 'Too many wrong keys. Try again in ten minutes.';
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (real && key === real) return '';
  cache.put('admin_fails', String(fails + 1), 600);
  Utilities.sleep(1500);
  return 'Wrong admin key.';
}

/** ?action=settings gives the order page its settings; with no action it only says the web app is live. */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'settings') {
    return json_({ ok: true, settings: publicSettings_(settings_()) });
  }
  return json_({ ok: true, service: 'study-notes print orders' });
}

/** The order page posts a JSON order here (sent as text/plain, so the browser needs no preflight). */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.action === 'adminLoad' || data.action === 'adminSave') return admin_(data);
    if (data.website) return json_({ ok: true, orderId: 'SN-0' }); // filled only by spam bots
    const err = checkOrder_(data);
    if (err) return json_({ ok: false, error: err });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const orderId = appendOrder_(data, 'Web', new Date());
      return json_({ ok: true, orderId: orderId });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: 'Server error: ' + err.message });
  }
}

/** The admin page: load the settings, or save them. */
function admin_(data) {
  const bad = checkAdminKey_(String(data.key || ''));
  if (bad) return json_({ ok: false, error: bad });
  if (data.action === 'adminSave') {
    const st = data.settings || {};
    const err = checkSettings_(st);
    if (err) return json_({ ok: false, error: err });
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      writeSettings_(st);
    } finally {
      lock.releaseLock();
    }
  }
  return json_({ ok: true, settings: settings_(), sheet: ss_().getUrl() });
}

function checkOrder_(d) {
  const str = v => typeof v === 'string' && v.trim().length > 0;
  if (!str(d.name) || !str(d.studentId) || !str(d.phone)) return 'Name, student ID and WhatsApp number are needed.';
  if (!/^[+0-9 -]{11,16}$/.test(d.phone.trim())) return 'Please enter a valid phone number.';
  if (str(d.mobile) && !/^[+0-9 -]{11,16}$/.test(d.mobile.trim())) return 'Please enter a valid mobile number.';
  if (!Array.isArray(d.items) || d.items.length === 0) return 'No pack chosen.';
  if (d.items.length > 50) return 'Too many lines in one order.';
  const st = settings_();
  if (!st.accepting_orders) return 'Print orders are paused right now. Please message me on WhatsApp.';
  const ok = (list, v) => (list || []).some(o => o.available && o.name === v);
  if (!ok(st.binding, d.binding)) return 'That binding is not available now.';
  if (!ok(st.pickup, d.pickup)) return 'That pickup option is not available now.';
  if (!ok(st.payment, d.payment)) return 'That payment option is not available now.';
  const cat = catalogueById_();
  for (const it of d.items) {
    if (!cat[it.id] || !cat[it.id].printable || isHidden_(st, cat[it.id])) return 'Unknown pack: ' + it.id;
    if (!ok(st.print, it.print || d.print)) return 'That print type is not available now.';
    const n = Number(it.copies);
    if (!(n >= 1 && n <= CONFIG.MAX_COPIES)) return 'Copies must be 1 to ' + CONFIG.MAX_COPIES + '.';
  }
  return '';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------- the orders

/** Writes one row per pack and returns the order ID. */
function appendOrder_(order, source, when) {
  const ss = ss_();
  const sh = ss.getSheetByName(SHEETS.orders) || setupOrdersSheet_(ss);
  const site = siteDefaults_();
  const cat = catalogueById_();
  const orderId = 'SN-' + Utilities.formatDate(when, Session.getScriptTimeZone(), 'yyMMdd') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  const t = v => (v == null ? '' : String(v).slice(0, 500));
  const items = order.items.length ? order.items : [{ id: '', label: '(no pack ticked)', copies: 0 }];
  const st = settings_();
  const rateOf = name => { const p = (st.print || []).find(o => o.name === name); return p ? Number(p.price_per_page) || 0 : 0; };
  const bind = (st.binding || []).find(o => o.name === order.binding);
  const bindPrice = bind ? Number(bind.price) || 0 : 0;
  const rows = items.map(it => {
    const c = cat[it.id] || {};
    const n = Number(it.copies) || 0;
    const print = it.print || order.print; // one per pack; an older page sent one per order
    const rate = rateOf(print);
    const price = rate && c.pages ? Math.round((c.pages * rate + bindPrice) * n) : '';
    return [
      when, orderId, source, t(order.name), t(order.studentId),
      t(order.department || site.department), t(order.batch || site.batch), "'" + t(order.phone),
      c.subject || '', c.session || '', c.document || t(it.label), it.id || '',
      Number(it.copies) || 0, c.pages || '', t(order.binding), t(order.pickup),
      t(order.payment), t(order.trx), t(order.notes), 'New', price, t(print),
      "'" + t(order.mobile || order.phone),
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, ORDER_HEADERS.length).setValues(rows);
  if (CONFIG.NOTIFY_BY_EMAIL) notify_(orderId, source, order, rows);
  return orderId;
}

function siteDefaults_() {
  const props = PropertiesService.getScriptProperties();
  let d = props.getProperty('SITE_DEFAULTS');
  if (!d) {
    try {
      const s = fetchCatalogue_().site;
      d = JSON.stringify({ department: s.department.default, batch: s.batch.default });
      props.setProperty('SITE_DEFAULTS', d);
    } catch (e) {
      return { department: '', batch: '' };
    }
  }
  return JSON.parse(d);
}

function notify_(orderId, source, order, rows) {
  try {
    const lines = rows.map(r => '  ' + [r[8], r[9], r[10]].filter(String).join(' ') + ' x ' + r[12] +
      (r[21] ? ', ' + r[21] : '') + (r[20] !== '' ? ', ৳' + r[20] : '')).join('\n');
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'New print order ' + orderId + ' (' + source + ')',
      order.name + ' (' + order.studentId + '), WhatsApp ' + order.phone +
      (order.mobile ? ', mobile ' + order.mobile : '') + '\n\n' + lines +
      '\n\nBinding: ' + (order.binding || '') + '\nPickup: ' + (order.pickup || '') +
      '\nPayment: ' + (order.payment || '') + (order.trx ? ' (' + order.trx + ')' : '') +
      (order.notes ? '\nNotes: ' + order.notes : '') + '\n\n' + ss_().getUrl());
  } catch (e) { /* an order is never lost because an email failed */ }
}

// ---------------------------------------------------------------- tabs

function setupOrdersSheet_(ss) {
  const sh = ss.getSheetByName(SHEETS.orders) || ss.insertSheet(SHEETS.orders, 0);
  sh.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  sh.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  const status = sh.getRange(2, STATUS_COL, sh.getMaxRows() - 1, 1);
  status.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  const rules = STATUSES.map(s => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$T2="' + s + '"').setBackground(STATUS_COLOURS[s])
    .setRanges([sh.getRange(2, 1, sh.getMaxRows() - 1, ORDER_HEADERS.length)]).build());
  sh.setConditionalFormatRules(rules);
  return sh;
}

function setupSummarySheet_(ss) {
  const sh = ss.getSheetByName(SHEETS.summary) || ss.insertSheet(SHEETS.summary, 1);
  sh.clear();
  const o = "'" + SHEETS.orders + "'!A:V";
  const blocks = [
    ['A1', 'To print (New, Price sent, Paid)',
      '=QUERY(' + o + ',"select I, J, K, V, sum(M), max(N) where (T = \'New\' or T = \'Price sent\' or T = \'Paid\') and L <> \'\' group by I, J, K, V label V \'Print\', sum(M) \'Copies\', max(N) \'Pages each\'",1)'],
    ['H1', 'By department and batch',
      '=QUERY(' + o + ',"select F, G, I, J, sum(M) where B is not null and T <> \'Cancelled\' group by F, G, I, J label sum(M) \'Copies\'",1)'],
    ['N1', 'Orders by status',
      '=QUERY(' + o + ',"select T, count(B) where B is not null group by T label count(B) \'Lines\'",1)'],
  ];
  blocks.forEach(([cell, title, formula]) => {
    const r = sh.getRange(cell);
    r.setValue(title).setFontWeight('bold');
    r.offset(1, 0).setFormula(formula);
  });
  sh.setFrozenRows(2);
}
