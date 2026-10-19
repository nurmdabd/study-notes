/**
 * Print orders for https://nurmdabd.github.io/study-notes/
 *
 * One script, two ways to order, one list of orders:
 *   - the web order page sends each order here (doPost);
 *   - the Google Form this script makes calls handleFormSubmit.
 * Both write the same rows into the "Orders" tab, one row per pack ordered.
 *
 * The list of packs lives in catalogue.json on the website. Every hour (and when you run syncNow)
 * the script reads it, copies it into the "Catalogue" tab and rewrites the form's tick boxes,
 * so a new pack on the website reaches the form without touching it.
 *
 * Prices and order options live in the "Settings" tab. Change them on the admin page
 * (https://nurmdabd.github.io/study-notes/admin.html, with the key from showAdminKey) or in the tab.
 * The order page reads them from this web app, so a change shows at once.
 *
 * Setup: see SETUP.md. In short: paste this file, run setup once, deploy as a web app.
 */

const CONFIG = {
  CATALOGUE_URL: 'https://nurmdabd.github.io/study-notes/catalogue.json',
  FORM_TITLE: "Printed copy order: Nur Mohammad's study notes",
  NOTIFY_BY_EMAIL: true, // an email to you for every new order
  MAX_COPIES: 20,
};

const SHEETS = { orders: 'Orders', catalogue: 'Catalogue', summary: 'Summary', settings: 'Settings' };

const ORDER_HEADERS = [
  'Received', 'Order ID', 'Source', 'Name', 'Student ID', 'Department', 'Batch', 'WhatsApp',
  'Subject', 'Session', 'Document', 'Item ID', 'Copies', 'Pages', 'Binding', 'Pickup',
  'Payment', 'Transaction ID', 'Notes', 'Status', 'Estimate (BDT)', 'Print',
];
const STATUS_COL = ORDER_HEADERS.indexOf('Status') + 1; // T
const STATUSES = ['New', 'Price sent', 'Paid', 'Printed', 'Delivered', 'Cancelled'];
const STATUS_COLOURS = {
  'New': '#fde68a', 'Price sent': '#bfdbfe', 'Paid': '#bbf7d0',
  'Printed': '#ddd6fe', 'Delivered': '#e5e7eb', 'Cancelled': '#fecaca',
};

// Form question titles that are fixed (the subject questions are named from the catalogue).
const Q = {
  name: 'Name', id: 'Student ID', phone: 'WhatsApp number', dept: 'Department', batch: 'Batch',
  copies: 'Copies of each pack', print: 'Print', binding: 'Binding', pickup: 'Pickup', payment: 'Payment',
  trx: 'Transaction ID', notes: 'Notes',
};

// ---------------------------------------------------------------- setup

/** Run once from the editor: makes the tabs, the form and the triggers. Safe to run again. */
function setup() {
  const ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  setupOrdersSheet_(ss);
  const cat = fetchCatalogue_();
  writeCatalogueSheet_(ss, cat);
  const form = getOrCreateForm_(cat);
  syncForm_(form, cat);
  writePrefilledLinks_(ss, form, cat);
  setupSummarySheet_(ss);
  settings_(); // makes the Settings tab from catalogue.json the first time
  syncFormOptions_(form, settings_());
  installTriggers_(form);
  showAdminKey();
  Logger.log('Form (share this): ' + form.getPublishedUrl());
  Logger.log('Form (edit): ' + form.getEditUrl());
  Logger.log('Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).');
}

/** Run any time to pull the catalogue and refresh the form now (the hourly trigger does the same). */
function syncNow() {
  const ss = ss_();
  const cat = fetchCatalogue_();
  PropertiesService.getScriptProperties().setProperty('SITE_DEFAULTS',
    JSON.stringify({ department: cat.site.department.default, batch: cat.site.batch.default }));
  writeCatalogueSheet_(ss, cat);
  const form = getOrCreateForm_(cat);
  syncForm_(form, cat);
  syncFormOptions_(form, settings_());
  writePrefilledLinks_(ss, form, cat);
}

/**
 * Run once after updating the script (safe to run again): brings the Orders and Summary tabs, the
 * Settings tab and the form up to date, and shows the admin key.
 */
function upgrade() {
  const ss = ss_();
  ss.getSheetByName(SHEETS.orders).getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS])
    .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  writeSettings_(settings_()); // adds new settings with their defaults
  const id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (id) addPrintQuestion_(FormApp.openById(id), settings_());
  setupSummarySheet_(ss);
  syncNow();
  showAdminKey();
}

/** Adds the "Print" question (black and white or colour) to a form made before it existed. */
function addPrintQuestion_(form, st) {
  if (form.getItems(FormApp.ItemType.MULTIPLE_CHOICE).some(it => it.getTitle() === Q.print)) return;
  const binding = form.getItems(FormApp.ItemType.MULTIPLE_CHOICE).find(it => it.getTitle() === Q.binding);
  const q = form.addMultipleChoiceItem().setTitle(Q.print).setRequired(true)
    .setChoiceValues(st.print.filter(o => o.available).map(o => o.name));
  if (binding) form.moveItem(q.getIndex(), binding.getIndex());
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

function installTriggers_(form) {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('handleFormSubmit').forForm(form).onFormSubmit().create();
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
    it.choice = choiceLabel_(it);
  });
  cat.subjectMap = subjects;
  return cat;
}

/** The text of an item's tick box in the form, inside its subject's question. */
function choiceLabel_(it) {
  return it.session + ' ' + it.document.toLowerCase() + ' (' + it.pages + ' pages)';
}

function subjectQuestionTitle_(s) {
  return s.code + ' ' + s.short + ': ' + s.title;
}

function writeCatalogueSheet_(ss, cat) {
  const sh = ss.getSheetByName(SHEETS.catalogue) || ss.insertSheet(SHEETS.catalogue);
  const header = ['Item ID', 'Subject', 'Short', 'Title', 'Session', 'Document', 'Pages', 'Printable', 'Download', 'Form link (pre-filled)'];
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, header.length).getValues() : [];
  const oldLinks = {};
  old.forEach(r => { oldLinks[r[0]] = r[9]; });
  const rows = cat.items.map(it => [
    it.id, it.subject, it.subjectInfo.short, it.subjectInfo.title, it.session, it.document,
    it.pages, it.printable ? 'yes' : 'no', it.url, oldLinks[it.id] || '',
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

// ---------------------------------------------------------------- the form

function getOrCreateForm_(cat) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FORM_ID');
  if (id) {
    try { return FormApp.openById(id); } catch (e) { /* deleted: make a new one */ }
  }
  const s = cat.site;
  const form = FormApp.create(CONFIG.FORM_TITLE);
  form.setDescription(
    'Printed copies of my exam packs (past-paper solution + formula sheet), black and white.\n' +
    s.price_note + '\n' +
    'Free PDFs and a quicker order page: https://nurmdabd.github.io/study-notes/');
  form.setCollectEmail(false);
  try { form.setRequireLogin(false); } catch (e) { /* only Workspace accounts have this setting */ }
  form.setLimitOneResponsePerUser(false);
  form.setAllowResponseEdits(true);
  form.setConfirmationMessage("Thanks! I'll message you on WhatsApp with the price before printing.");

  form.addTextItem().setTitle(Q.name).setRequired(true);
  form.addTextItem().setTitle(Q.id).setRequired(true);
  form.addTextItem().setTitle(Q.phone).setRequired(true)
    .setHelpText('For example 01XXXXXXXXX')
    .setValidation(FormApp.createTextValidation()
      .requireTextMatchesPattern('^[+0-9 -]{11,16}$')
      .setHelpText('Please enter a valid phone number').build());
  if (s.department.ask) form.addListItem().setTitle(Q.dept).setChoiceValues(s.department.options).setRequired(true);
  if (s.batch.ask) form.addListItem().setTitle(Q.batch).setChoiceValues(s.batch.options).setRequired(true);

  const packs = form.addPageBreakItem().setTitle('Choose packs')
    .setHelpText('Tick every pack you want, in any subject.');
  const printing = form.addPageBreakItem().setTitle('Printing and payment');
  form.addTextItem().setTitle(Q.copies).setRequired(true)
    .setHelpText('Different numbers for different packs? Write them in Notes.')
    .setValidation(FormApp.createTextValidation()
      .requireNumberBetween(1, CONFIG.MAX_COPIES).build());
  form.addMultipleChoiceItem().setTitle(Q.print).setChoiceValues(['Black and white']).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.binding).setChoiceValues(['Stapled']).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.pickup).setChoiceValues(['On campus']).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.payment).setChoiceValues(['Cash at pickup']).setRequired(true)
    .setHelpText('bKash or Nagad: I send the number with the price.');
  form.addTextItem().setTitle(Q.trx).setHelpText('Only if you already paid by bKash or Nagad.');
  form.addParagraphTextItem().setTitle(Q.notes);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
  props.setProperty('FORM_ID', form.getId());
  props.setProperty('PB_PACKS', String(packs.getId()));
  props.setProperty('PB_PRINTING', String(printing.getId()));
  syncFormOptions_(form, settings_()); // the real options, from the Settings tab
  return form;
}

/** One tick-box question per subject, between the "Choose packs" and "Printing and payment" pages. */
function syncForm_(form, cat) {
  const props = PropertiesService.getScriptProperties();
  const known = JSON.parse(props.getProperty('SUBJECT_ITEMS') || '{}'); // subject code -> item id
  const bySubject = {};
  const hidden = settings_().hidden || { subjects: [], items: [] };
  cat.items.filter(it => it.printable && !isHidden_(hidden, it)).forEach(it => {
    (bySubject[it.subject] = bySubject[it.subject] || []).push(it);
  });
  const printingId = Number(props.getProperty('PB_PRINTING'));
  const indexOfPrinting = () => form.getItemById(printingId).getIndex();

  cat.subjects.forEach(s => {
    const items = bySubject[s.code];
    let q = known[s.code] ? form.getItemById(Number(known[s.code])) : null;
    if (!items) {
      if (q) { form.deleteItem(q); delete known[s.code]; }
      return;
    }
    if (!q) {
      q = form.addCheckboxItem();
      form.moveItem(q.getIndex(), indexOfPrinting());
      known[s.code] = String(q.getId());
    }
    q.asCheckboxItem().setTitle(subjectQuestionTitle_(s)).setChoiceValues(items.map(it => it.choice));
  });
  Object.keys(known).forEach(code => {
    if (!cat.subjectMap[code]) {
      const q = form.getItemById(Number(known[code]));
      if (q) form.deleteItem(q);
      delete known[code];
    }
  });
  props.setProperty('SUBJECT_ITEMS', JSON.stringify(known));
  // label -> item ID, to turn the ticks of a response back into packs
  const choiceMap = {};
  cat.items.forEach(it => { choiceMap[it.subject + '|' + it.choice] = it.id; });
  props.setProperty('CHOICE_MAP', JSON.stringify(choiceMap));
}

/** A link per pack that opens the form with that pack already ticked. */
function writePrefilledLinks_(ss, form, cat) {
  const known = JSON.parse(PropertiesService.getScriptProperties().getProperty('SUBJECT_ITEMS') || '{}');
  const sh = ss.getSheetByName(SHEETS.catalogue);
  cat.items.forEach((it, i) => {
    if (!it.printable || !known[it.subject]) return;
    const q = form.getItemById(Number(known[it.subject])).asCheckboxItem();
    const url = form.createResponse().withItemResponse(q.createResponse([it.choice])).toPrefilledUrl();
    sh.getRange(i + 2, 10).setValue(url);
  });
}

function handleFormSubmit(e) {
  const choiceMap = JSON.parse(PropertiesService.getScriptProperties().getProperty('CHOICE_MAP') || '{}');
  const known = JSON.parse(PropertiesService.getScriptProperties().getProperty('SUBJECT_ITEMS') || '{}');
  const subjectOfItem = {};
  Object.keys(known).forEach(code => { subjectOfItem[known[code]] = code; });

  const order = { items: [] };
  let copies = 1;
  e.response.getItemResponses().forEach(r => {
    const item = r.getItem();
    const title = item.getTitle();
    const answer = r.getResponse();
    const subject = subjectOfItem[String(item.getId())];
    if (subject) {
      (answer || []).forEach(label => {
        order.items.push({ id: choiceMap[subject + '|' + label] || '', label: subject + ' ' + label });
      });
      return;
    }
    switch (title) {
      case Q.name: order.name = answer; break;
      case Q.id: order.studentId = answer; break;
      case Q.phone: order.phone = answer; break;
      case Q.dept: order.department = answer; break;
      case Q.batch: order.batch = answer; break;
      case Q.copies: copies = Number(answer) || 1; break;
      case Q.print: order.print = answer; break;
      case Q.binding: order.binding = answer; break;
      case Q.pickup: order.pickup = answer; break;
      case Q.payment: order.payment = answer; break;
      case Q.trx: order.trx = answer; break;
      case Q.notes: order.notes = answer; break;
    }
  });
  order.items.forEach(it => { it.copies = copies; });
  appendOrder_(order, 'Form', e.response.getTimestamp());
}

// ---------------------------------------------------------------- the web order page

// ---------------------------------------------------------------- settings

/*
 * The Settings tab: one row per setting, the value as JSON. Edit it on the admin page; by hand only
 * with care. Options are lists of {name, available} (binding also has price, in BDT per copy).
 */
const SETTING_KEYS = ['accepting_orders', 'price_note', 'show_estimate', 'print',
  'binding', 'pickup', 'payment', 'department', 'batch', 'hidden'];
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
  hidden: '{"subjects": [subject codes], "items": [pack IDs]} hidden from the page and the form.',
  binding: 'List of {"name", "price" (BDT per copy), "available"}.',
  pickup: 'List of {"name", "available"}.',
  payment: 'List of {"name", "available"}.',
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
  if (OLD_PRICE_NOTES.includes(out.price_note)) out.price_note = PRICE_NOTE;
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
  let formUrl = '';
  try {
    const id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
    if (id) formUrl = FormApp.openById(id).getPublishedUrl();
  } catch (e) { /* no form */ }
  return {
    accepting_orders: !!st.accepting_orders, price_note: st.price_note,
    show_estimate: !!st.show_estimate,
    print: avail(st.print).map(o => ({ name: o.name, price_per_page: Number(o.price_per_page) || 0 })),
    binding: avail(st.binding).map(o => ({ name: o.name, price: Number(o.price) || 0 })),
    hidden: st.hidden,
    pickup: avail(st.pickup).map(o => o.name), payment: avail(st.payment).map(o => o.name),
    department: st.department, batch: st.batch, google_form: formUrl,
  };
}

/** Checks a settings object from the admin page; returns '' or what is wrong. */
function checkSettings_(st) {
  const isList = l => Array.isArray(l) && l.every(o => o && typeof o.name === 'string' && o.name.trim());
  if (typeof st.price_note !== 'string') return 'The price note is missing.';
  if (!isList(st.print) || st.print.some(o => !(Number(o.price_per_page) >= 0))) return 'Every print type needs a name and a price of 0 or more.';
  if (!st.print.some(o => o.available)) return 'At least one print type must be available.';
  if (!st.hidden || !Array.isArray(st.hidden.subjects) || !Array.isArray(st.hidden.items)) return 'The hidden list is malformed.';
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

function isHidden_(hidden, it) {
  return hidden.subjects.includes(it.subject) || hidden.items.includes(it.id);
}

/** Gives the form's print, binding, pickup and payment questions the available options. */
function syncFormOptions_(form, st) {
  const want = { [Q.print]: st.print, [Q.binding]: st.binding, [Q.pickup]: st.pickup, [Q.payment]: st.payment };
  form.getItems(FormApp.ItemType.MULTIPLE_CHOICE).forEach(it => {
    const list = want[it.getTitle()];
    if (!list) return;
    const names = list.filter(o => o.available).map(o => o.name);
    if (names.length) it.asMultipleChoiceItem().setChoiceValues(names);
  });
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
      const id = PropertiesService.getScriptProperties().getProperty('FORM_ID');
      if (id) {
        const form = FormApp.openById(id);
        syncFormOptions_(form, st);
        try { // shown and hidden packs; the hourly sync catches up if the website does not answer
          const cat = fetchCatalogue_();
          syncForm_(form, cat);
          writePrefilledLinks_(ss_(), form, cat);
        } catch (e) { /* later */ }
      }
    } finally {
      lock.releaseLock();
    }
  }
  const props = PropertiesService.getScriptProperties();
  let formEdit = '';
  try { formEdit = FormApp.openById(props.getProperty('FORM_ID')).getEditUrl(); } catch (e) { /* no form */ }
  return json_({ ok: true, settings: settings_(), sheet: ss_().getUrl(), formEdit: formEdit });
}

function checkOrder_(d) {
  const str = v => typeof v === 'string' && v.trim().length > 0;
  if (!str(d.name) || !str(d.studentId) || !str(d.phone)) return 'Name, student ID and WhatsApp number are needed.';
  if (!/^[+0-9 -]{11,16}$/.test(d.phone.trim())) return 'Please enter a valid phone number.';
  if (!Array.isArray(d.items) || d.items.length === 0) return 'No pack chosen.';
  if (d.items.length > 50) return 'Too many lines in one order.';
  const st = settings_();
  if (!st.accepting_orders) return 'Print orders are paused right now. Please message me on WhatsApp.';
  const ok = (list, v) => (list || []).some(o => o.available && o.name === v);
  if (!ok(st.print, d.print)) return 'That print type is not available now.';
  if (!ok(st.binding, d.binding)) return 'That binding is not available now.';
  if (!ok(st.pickup, d.pickup)) return 'That pickup option is not available now.';
  if (!ok(st.payment, d.payment)) return 'That payment option is not available now.';
  const cat = catalogueById_();
  for (const it of d.items) {
    if (!cat[it.id] || !cat[it.id].printable || isHidden_(st.hidden, cat[it.id])) return 'Unknown pack: ' + it.id;
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
  const type = (st.print || []).find(o => o.name === order.print);
  const rate = type ? Number(type.price_per_page) || 0 : 0;
  const bind = (st.binding || []).find(o => o.name === order.binding);
  const bindPrice = bind ? Number(bind.price) || 0 : 0;
  const rows = items.map(it => {
    const c = cat[it.id] || {};
    const n = Number(it.copies) || 0;
    const estimate = rate && c.pages ? Math.round((c.pages * rate + bindPrice) * n) : '';
    return [
      when, orderId, source, t(order.name), t(order.studentId),
      t(order.department || site.department), t(order.batch || site.batch), "'" + t(order.phone),
      c.subject || '', c.session || '', c.document || t(it.label), it.id || '',
      Number(it.copies) || 0, c.pages || '', t(order.binding), t(order.pickup),
      t(order.payment), t(order.trx), t(order.notes), 'New', estimate, t(order.print),
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
    const lines = rows.map(r => '  ' + [r[8], r[9], r[10]].filter(String).join(' ') + ' x ' + r[12]).join('\n');
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      'New print order ' + orderId + ' (' + source + ')',
      order.name + ' (' + order.studentId + '), WhatsApp ' + order.phone + '\n\n' + lines +
      '\n\nPrint: ' + (order.print || '') + '\nBinding: ' + (order.binding || '') + '\nPickup: ' + (order.pickup || '') +
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
