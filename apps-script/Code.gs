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
 * Setup: see SETUP.md. In short: paste this file, run setup once, deploy as a web app.
 */

const CONFIG = {
  CATALOGUE_URL: 'https://nurmdabd.github.io/study-notes/catalogue.json',
  FORM_TITLE: "Printed copy order: Nur Mohammad's study notes",
  NOTIFY_BY_EMAIL: true, // an email to you for every new order
  MAX_COPIES: 20,
};

const SHEETS = { orders: 'Orders', catalogue: 'Catalogue', summary: 'Summary' };

const ORDER_HEADERS = [
  'Received', 'Order ID', 'Source', 'Name', 'Student ID', 'Department', 'Batch', 'WhatsApp',
  'Subject', 'Session', 'Document', 'Item ID', 'Copies', 'Pages', 'Binding', 'Pickup',
  'Payment', 'Transaction ID', 'Notes', 'Status',
];
const STATUSES = ['New', 'Price sent', 'Paid', 'Printed', 'Delivered', 'Cancelled'];
const STATUS_COLOURS = {
  'New': '#fde68a', 'Price sent': '#bfdbfe', 'Paid': '#bbf7d0',
  'Printed': '#ddd6fe', 'Delivered': '#e5e7eb', 'Cancelled': '#fecaca',
};

// Form question titles that are fixed (the subject questions are named from the catalogue).
const Q = {
  name: 'Name', id: 'Student ID', phone: 'WhatsApp number', dept: 'Department', batch: 'Batch',
  copies: 'Copies of each pack', binding: 'Binding', pickup: 'Pickup', payment: 'Payment',
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
  installTriggers_(form);
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
  writePrefilledLinks_(ss, form, cat);
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
  form.addMultipleChoiceItem().setTitle(Q.binding).setChoiceValues(s.binding).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.pickup).setChoiceValues(s.pickup).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.payment).setChoiceValues(s.payment).setRequired(true)
    .setHelpText('bKash or Nagad: I send the number with the price.');
  form.addTextItem().setTitle(Q.trx).setHelpText('Only if you already paid by bKash or Nagad.');
  form.addParagraphTextItem().setTitle(Q.notes);

  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId());
  props.setProperty('FORM_ID', form.getId());
  props.setProperty('PB_PACKS', String(packs.getId()));
  props.setProperty('PB_PRINTING', String(printing.getId()));
  return form;
}

/** One tick-box question per subject, between the "Choose packs" and "Printing and payment" pages. */
function syncForm_(form, cat) {
  const props = PropertiesService.getScriptProperties();
  const known = JSON.parse(props.getProperty('SUBJECT_ITEMS') || '{}'); // subject code -> item id
  const bySubject = {};
  cat.items.filter(it => it.printable).forEach(it => {
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

/** Check the web app is live: open its URL in a browser. */
function doGet() {
  return json_({ ok: true, service: 'study-notes print orders' });
}

/** The order page posts a JSON order here (sent as text/plain, so the browser needs no preflight). */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
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

function checkOrder_(d) {
  const str = v => typeof v === 'string' && v.trim().length > 0;
  if (!str(d.name) || !str(d.studentId) || !str(d.phone)) return 'Name, student ID and WhatsApp number are needed.';
  if (!/^[+0-9 -]{11,16}$/.test(d.phone.trim())) return 'Please enter a valid phone number.';
  if (!Array.isArray(d.items) || d.items.length === 0) return 'No pack chosen.';
  if (d.items.length > 50) return 'Too many lines in one order.';
  const cat = catalogueById_();
  for (const it of d.items) {
    if (!cat[it.id] || !cat[it.id].printable) return 'Unknown pack: ' + it.id;
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
  const rows = items.map(it => {
    const c = cat[it.id] || {};
    return [
      when, orderId, source, t(order.name), t(order.studentId),
      t(order.department || site.department), t(order.batch || site.batch), "'" + t(order.phone),
      c.subject || '', c.session || '', c.document || t(it.label), it.id || '',
      Number(it.copies) || 0, c.pages || '', t(order.binding), t(order.pickup),
      t(order.payment), t(order.trx), t(order.notes), 'New',
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
  const status = sh.getRange(2, ORDER_HEADERS.length, sh.getMaxRows() - 1, 1);
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
  const o = "'" + SHEETS.orders + "'!A:T";
  const blocks = [
    ['A1', 'To print (New, Price sent, Paid)',
      '=QUERY(' + o + ',"select I, J, K, sum(M), max(N) where (T = \'New\' or T = \'Price sent\' or T = \'Paid\') and L <> \'\' group by I, J, K label sum(M) \'Copies\', max(N) \'Pages each\'",1)'],
    ['G1', 'By department and batch',
      '=QUERY(' + o + ',"select F, G, I, J, sum(M) where B is not null and T <> \'Cancelled\' group by F, G, I, J label sum(M) \'Copies\'",1)'],
    ['M1', 'Orders by status',
      '=QUERY(' + o + ',"select T, count(B) where B is not null group by T label count(B) \'Lines\'",1)'],
  ];
  blocks.forEach(([cell, title, formula]) => {
    const r = sh.getRange(cell);
    r.setValue(title).setFontWeight('bold');
    r.offset(1, 0).setFormula(formula);
  });
  sh.setFrozenRows(2);
}
