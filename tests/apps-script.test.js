// Tests apps-script/Code.gs against a mock of the Google services:  node tests/apps-script.test.js
const fs = require('fs'), vm = require('vm');
const code = fs.readFileSync(require('path').join(__dirname, '../apps-script/Code.gs'), 'utf8');
const catalogue = fs.readFileSync(require('path').join(__dirname, '../catalogue.json'), 'utf8');
// chainable no-op for builders and formatting
const chain = () => new Proxy(function () {}, { get: (t, k) => k === 'build' ? () => ({}) : chain, apply: () => chain() });
function Sheet(name) {
  this.name = name; this.data = [];
  const self = this;
  const cell = (r, c) => { while (self.data.length < r) self.data.push([]); return self.data[r - 1][c - 1]; };
  this.getName = () => name;
  this.getLastRow = () => { for (let i = self.data.length; i > 0; i--) if ((self.data[i-1]||[]).some(v => v !== '' && v != null)) return i; return 0; };
  this.getMaxRows = () => 1000;
  this.clear = () => { self.data = []; return self; };
  this.getRange = (r, c, nr = 1, nc = 1) => {
    if (typeof r === 'string') return Object.assign(chain(), { setValue() { return this; }, offset() { return chain(); } });
    let P;
    const rng = {
      setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { while (self.data.length < r + i) self.data.push([]); self.data[r - 1 + i][c - 1 + j] = x; })); return P; },
      setValue(x) { return rng.setValues([[x]]); },
      getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = cell(r + i, c + j); row.push(v == null ? '' : v); } out.push(row); } return out; },
      getValue() { return rng.getValues()[0][0]; },
    };
    P = new Proxy(rng, { get: (t, k) => k in t ? t[k] : () => P });
    return P;
  };
  return new Proxy(this, { get: (t, k) => k in t ? t[k] : () => chain() });
}

// ---- a mock Google Form, for setup, upgrade, the form sync and form orders. Like Google's: a question
// just added is a typed item (CheckboxItem, ListItem, ...) without the as...Item() methods; one read
// back with getItems or getItemById is a plain Item with them.
function makeForm() {
  let next = 1; const items = []; // plain-Item handles
  const header = { title: '', description: '' };
  const AS = ['asCheckboxItem', 'asMultipleChoiceItem', 'asListItem', 'asTextItem', 'asParagraphTextItem', 'asPageBreakItem'];
  const handles = t => {
    let typed, plain;
    const get = isPlain => (o, k) => {
      if (k in o) return o[k];
      if (k === 'getId') return () => o.id;
      if (k === 'getTitle') return () => o.title;
      if (k === 'getType') return () => o.type;
      if (k === 'getIndex') return () => items.findIndex(i => i.__t === o);
      if (k === '__t') return o;
      if (AS.includes(k)) {
        if (!isPlain) return undefined; // a typed item has no as...Item(): calling it throws, as in Apps Script
        return () => typed;
      }
      if (k === 'setTitle') return v => { o.title = v; return typed; };
      if (k === 'setChoiceValues') return v => { o.choices = v.slice(); return typed; };
      if (k === 'setHelpText') return v => { o.help = v; return typed; };
      if (k === 'createResponse') return v => ({ item: o, v });
      return () => typed;
    };
    typed = new Proxy(t, { get: get(false) });
    plain = new Proxy(t, { get: get(true) });
    return { typed, plain };
  };
  const form = new Proxy({}, { get: (_, k) => {
    if (k === 'items') return items;
    if (k === 'header') return header;
    if (k === 'getId') return () => 'F';
    if (k === 'getPublishedUrl') return () => 'https://forms/F/viewform';
    if (k === 'getEditUrl') return () => 'https://forms/F/edit';
    if (k === 'setTitle') return v => { header.title = v; return form; };
    if (k === 'setDescription') return v => { header.description = v; return form; };
    if (k === 'getItems') return type => items.filter(i => !type || i.__t.type === type);
    if (k === 'getItemById') return id => items.find(i => i.__t.id === id) || null;
    if (k === 'deleteItem') return i => { const n = items.findIndex(x => x.__t === i.__t); if (n >= 0) items.splice(n, 1); };
    if (k === 'moveItem') return (from, to) => { const [i] = items.splice(from, 1); items.splice(to, 0, i); };
    if (k === 'createResponse') return () => { const r = { parts: [] }; r.withItemResponse = x => { r.parts.push(x); return r; }; r.toPrefilledUrl = () => 'https://forms/F/prefill?' + r.parts.map(x => x.v.join(',')).join('&'); return r; };
    const add = { addTextItem: 'TEXT', addParagraphTextItem: 'PARA', addListItem: 'LIST', addPageBreakItem: 'PB',
      addCheckboxItem: 'CHECKBOX', addMultipleChoiceItem: 'MC' }[k];
    if (add) return () => { const h = handles({ id: next++, type: add, title: '', choices: [] }); items.push(h.plain); return h.typed; };
    return () => form;
  } });
  return form;
}
const sheets = {};
const ss = { getId: () => 'SHEET', getUrl: () => 'https://docs.google.com/sheet', getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = new Sheet(n)) };
const props = {};
const ctx = {
  console, JSON, Math, Date, String, Number, Object, Array, Error,
  SpreadsheetApp: { getActive: () => ss, openById: () => ss, newDataValidation: chain, newConditionalFormatRule: chain },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => catalogue }) },
  CacheService: { getScriptCache: () => { const m = ctx.__cache; return { get: k => m[k] || null, put: (k, v) => { m[k] = v; } }; } },
  __cache: {},
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Utilities: { getUuid: () => 'abcd1234-ef56-7890-abcd-1234567890ab', sleep() {}, formatDate: () => '261019' },
  Session: { getScriptTimeZone: () => 'Asia/Dhaka', getEffectiveUser: () => ({ getEmail: () => 'me@x' }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ body: s }) }) },
  MailApp: { sendEmail: (...a) => { ctx.__mail.push(a); } }, __mail: [],
  Logger: { log: s => console.log('  LOG', s) },
  FormApp: { ItemType: { MULTIPLE_CHOICE: 'MC', LIST: 'LIST', CHECKBOX: 'CHECKBOX', TEXT: 'TEXT' }, DestinationType: { SPREADSHEET: 'S' },
    openById: () => { if (!ctx.__form) throw new Error('no form'); return ctx.__form; },
    create: () => (ctx.__form = makeForm()), createTextValidation: chain },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: chain },
};
vm.createContext(ctx); vm.runInContext(code, ctx);
const run = s => vm.runInContext(s, ctx);
const post = obj => JSON.parse(run(`doPost({postData:{contents:${JSON.stringify(JSON.stringify(obj))}}})`).body);
let fail = 0; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

props.SHEET_ID = 'SHEET';
run(`setupOrdersSheet_(ss_()); writeCatalogueSheet_(ss_(), fetchCatalogue_()); showAdminKey();`);
const key = props.ADMIN_KEY;
check('admin key made', /^[0-9a-f]{16}$/.test(key), key);
const g0 = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body);
check('settings via doGet', g0.ok && g0.settings.binding.length === 1 && g0.settings.binding[0].name === 'Stapled', JSON.stringify(g0.settings.binding));
check('Settings tab keeps spiral, unavailable', JSON.stringify(run('settings_()').binding).includes('"Spiral binding"'));
check('ping', JSON.parse(run('doGet({parameter:{}})').body).service === 'study-notes print orders');

// a Settings tab as the previous script wrote it: one price per page, the old note
run(`writeSettings_(Object.assign(defaultSettings_(), {}))`);
const old = sheets.Settings.data;
old.push(['price_per_page', '0.5', ''], ['show_estimate', 'true', '']);
old.forEach(r => { if (r[0] === 'price_note') r[1] = JSON.stringify("At printing cost, no profit. The price can move a little with paper and printing costs, so I'll confirm it on WhatsApp before printing."); });
old.splice(old.findIndex(r => r[0] === 'print'), 1); old.splice(old.findIndex(r => r[0] === 'hidden'), 1);
const mig = run('settings_()');
check('old price per page becomes black-and-white rate', mig.print[0].price_per_page === 0.5 && mig.print[1].name === 'Colour' && !mig.print[1].available, JSON.stringify(mig.print));
check('old price note replaced', mig.price_note.startsWith('At printing cost. The price can vary slightly'));
check('hidden defaults', JSON.stringify(mig.hidden) === '{"subjects":[],"items":[]}');
run('writeSettings_(settings_())');
check('price_per_page row dropped', !sheets.Settings.data.some(r => r[0] === 'price_per_page'));

const g = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings;
check('page settings: print types', g.print.length === 1 && g.print[0].name === 'Black and white', JSON.stringify(g.print));

const order = { name: 'A', studentId: '1', phone: '01352679856', print: 'Black and white', binding: 'Stapled', pickup: g.pickup[0], payment: 'bKash',
  items: [{ id: 'EEE475-2019-20-pack', copies: 2 }, { id: 'EEE421-2020-21-pack', copies: 1 }] };
let r = post(order);
check('order accepted', r.ok && /^SN-261019-/.test(r.orderId), JSON.stringify(r));
let rows = sheets.Orders.data.slice(1).filter(x => x.length);
// 70*0.5*2 = 70 ; 118*0.5 = 59
check('two rows, estimate and print type saved', rows.length === 2 && rows[0][20] === 70 && rows[1][20] === 59 && rows[0][21] === 'Black and white',
  rows.map(x => x[11] + ' x' + x[12] + ' est=' + x[20] + ' ' + x[21]).join('; '));
check('status in column T', ORDER_STATUS_OK());
function ORDER_STATUS_OK() { return rows[0][19] === 'New' && run('STATUS_COL') === 20; }
check('default dept/batch', rows[0][5] === 'EEE' && rows[0][6] === '2021-22');
check('colour refused while unavailable', post({ ...order, print: 'Colour' }).error === 'That print type is not available now.');
check('missing print type refused', /print type/.test(post({ ...order, print: undefined }).error || ''));
check('spiral refused', post({ ...order, binding: 'Spiral binding' }).error === 'That binding is not available now.');
check('unknown pack refused', /Unknown pack/.test(post({ ...order, items: [{ id: 'X', copies: 1 }] }).error));
check('bad phone refused', /valid phone/.test(post({ ...order, phone: '123' }).error));
check('spam bot ignored', post({ ...order, website: 'x' }).orderId === 'SN-0');

check('wrong key refused', post({ action: 'adminLoad', key: 'nope' }).error === 'Wrong admin key.');
const L = post({ action: 'adminLoad', key });
check('admin load', L.ok && L.sheet && Array.isArray(L.settings.print));
const st = L.settings;
st.print[1].available = true; st.print[1].price_per_page = 3;
st.binding[1].available = true; st.binding[1].price = 30;
st.hidden = { subjects: ['EEE337'], items: ['EEE475-2020-21-pack'] };
let S = post({ action: 'adminSave', key, settings: st });
check('admin save', S.ok, S.error || '');
const g2 = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings;
check('page sees colour, spiral and hidden', g2.print.length === 2 && g2.binding.length === 2 && g2.hidden.items[0] === 'EEE475-2020-21-pack');
r = post({ ...order, print: 'Colour', binding: 'Spiral binding', items: [{ id: 'EEE475-2019-20-pack', copies: 1 }] });
const last = sheets.Orders.data.filter(x => x.length).slice(-1)[0];
check('colour estimate (70*3+30=240)', r.ok && last[20] === 240 && last[21] === 'Colour', last[20] + ' ' + last[21]);
check('hidden pack refused', /Unknown pack/.test(post({ ...order, items: [{ id: 'EEE475-2020-21-pack', copies: 1 }] }).error));
check('pack of hidden subject refused', /Unknown pack/.test(post({ ...order, items: [{ id: 'EEE337-2021-22-pack', copies: 1 }] }).error));
st.print.forEach(o => { o.available = false; });
check('save refuses no print type', /print type/.test(post({ action: 'adminSave', key, settings: st }).error));
st.print[0].available = true;
st.binding.forEach(b => { b.available = false; });
check('save refuses no binding', /At least one binding/.test(post({ action: 'adminSave', key, settings: st }).error));
st.binding[0].available = true; st.accepting_orders = false;
post({ action: 'adminSave', key, settings: st });
check('paused refuses orders', /paused/.test(post(order).error));
for (let i = 0; i < 10; i++) post({ action: 'adminLoad', key: 'bad' });
check('lockout after 10 wrong keys', /Too many/.test(post({ action: 'adminLoad', key }).error));
check('emails sent per order', ctx.__mail.length === 2, ctx.__mail.length);

// ---- the form: made by setup, brought up to date by upgrade, hidden packs left out, form orders
ctx.__mail.length = 0;
run(`(function(){ const st = settings_(); st.accepting_orders = true; st.hidden = { subjects: [], items: [] };
  st.print = [{ name: 'Black and white', price_per_page: 0.5, available: true }]; writeSettings_(st); })()`);
delete props.FORM_ID;
run('setup()');
let F = ctx.__form;
const titles = () => F.items.map(i => i.__t.title);
check('setup made a form with the Print question', titles().includes('Print') && titles().indexOf('Print') < titles().indexOf('Binding'), titles().join(' | '));
check('form options from settings', F.items.find(i => i.__t.title === 'Binding').choices.join() === 'Stapled');
// a form made before "Print" existed
F.deleteItem(F.items.find(i => i.__t.title === 'Print'));
run(`(function(){ const st = settings_(); st.print.push({ name: 'Colour', price_per_page: 3, available: true });
  st.hidden = { subjects: ['EEE337'], items: ['EEE475-2020-21-pack'] }; writeSettings_(st); })()`);
run('upgrade()');
F = ctx.__form;
const pq = F.items.find(i => i.__t.title === 'Print');
check('upgrade adds Print before Binding', pq && titles().indexOf('Print') === titles().indexOf('Binding') - 1 && pq.choices.join() === 'Black and white,Colour', titles().join(' | '));
check('upgrade wrote all order headers', sheets.Orders.data[0][21] === 'Print' && sheets.Orders.data[0][19] === 'Status');
check('hidden subject has no question', !titles().some(t => t.startsWith('EEE337')));
const rf = F.items.find(i => i.__t.title.startsWith('EEE475'));
check('hidden pack not offered', rf && rf.choices.length === 1 && rf.choices[0].startsWith('2019-20'), rf && rf.choices.join());
// a form response
const resp = (title, v) => ({ getItem: () => F.items.find(i => i.__t.title === title), getResponse: () => v });
const before = sheets.Orders.data.filter(x => x.length).length;
run('handleFormSubmit')( { response: { getTimestamp: () => new Date(), getItemResponses: () => [
  resp('Name', 'Form User'), resp('Student ID', '9'), resp('WhatsApp number', '01700000000'),
  resp(rf.title, [rf.choices[0]]), resp('Copies of each pack', '2'), resp('Print', 'Colour'),
  resp('Binding', 'Stapled'), resp('Pickup', 'On campus (place confirmed on WhatsApp)'), resp('Payment', 'Cash at pickup') ] } });
const fr = sheets.Orders.data.filter(x => x.length).slice(-1)[0];
check('form order row: pack, copies, colour, estimate', sheets.Orders.data.filter(x => x.length).length === before + 1 &&
  fr[2] === 'Form' && fr[11] === 'EEE475-2019-20-pack' && fr[12] === 2 && fr[21] === 'Colour' && fr[20] === 420, fr.slice(2, 22).join(' / '));

// ---- payment details, department and batch questions, a pack whose page count changed
run(`(function(){ const st = settings_(); st.payment = [{ name: 'Cash at pickup', available: true },
  { name: 'bKash', details: '01352679856 (personal, Send Money)', available: true }, { name: 'Nagad', details: '01700000000', available: false }];
  st.department = { ask: true, default: 'EEE', options: ['EEE', 'CSE'] }; writeSettings_(st); syncFormOptions_(ctx_form(), st); })()`.replace('ctx_form()', 'FormApp.openById("F")'));
const gp = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings;
check('page gets payment details of available methods only', JSON.stringify(gp.payment_details) === '{"bKash":"01352679856 (personal, Send Money)"}', JSON.stringify(gp.payment_details));
const pay = F.items.find(i => i.__t.title === 'Payment');
check('form payment help lists the number', /bKash: 01352679856/.test(pay.help) && !/Nagad/.test(pay.help), pay.help);
const dq = F.items.find(i => i.__t.title === 'Department');
check('department question added on the first page', dq && dq.choices.join() === 'EEE,CSE' && titles().indexOf('Department') === titles().indexOf('Choose packs') - 1, titles().slice(0, 6).join(' | '));
run(`(function(){ const st = settings_(); st.department.ask = false; writeSettings_(st); syncFormOptions_(FormApp.openById("F"), st); })()`);
check('department question removed when not asked', !titles().includes('Department'));
// the pack grows from 70 to 74 pages: the form shows the new label, an answer with the old one still maps
const catText = ctx.UrlFetchApp.fetch().getContentText();
const grown = JSON.parse(catText); grown.items.find(i => i.id === 'EEE475-2019-20-pack').pages = 74;
ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(grown) });
run('syncNow()');
const rf2 = F.items.find(i => i.__t.title.startsWith('EEE475'));
check('form label follows the new page count', rf2.choices[0] === '2019-20 exam pack (74 pages)', rf2.choices.join());
const cm = JSON.parse(props.CHOICE_MAP);
check('old label still maps to the pack', cm['EEE475|2019-20 exam pack (70 pages)'] === 'EEE475-2019-20-pack' && cm['EEE475|2019-20 exam pack (74 pages)'] === 'EEE475-2019-20-pack');
check('catalogue tab has the new page count', run('catalogueById_()')['EEE475-2019-20-pack'].pages === 74);

// ---- the empty questions an interrupted sync left in the live form are removed, the rest filled in
F.addCheckboxItem(); F.addCheckboxItem();
check('two orphan tick-box questions present', F.items.filter(i => i.__t.type === 'CHECKBOX' && !i.__t.title).length === 2);
run('syncNow()');
const boxes = F.items.filter(i => i.__t.type === 'CHECKBOX');
check('orphans removed, subject questions kept', boxes.every(i => i.__t.title) && boxes.length === 6, boxes.map(i => i.__t.title || '(empty)').join(' | '));
// a first sync on a fresh form (where the old script failed): every question gets its title and boxes
delete props.FORM_ID; delete props.SUBJECT_ITEMS; delete props.CHOICE_MAP;
run('setup()'); F = ctx.__form;
const fresh = F.items.filter(i => i.__t.type === 'CHECKBOX');
check('fresh form: subject questions titled and filled', fresh.length >= 5 && fresh.every(i => i.__t.title && i.__t.choices.length), fresh.map(i => i.__t.title).join(' | '));
check('form title and description from the settings', F.header.title === 'Print order: Study Notes by Nur Mohammad' &&
  F.header.description.includes('Printed copies: At printing cost.') && F.header.description.includes('https://nurmdabd.github.io/study-notes/'), JSON.stringify(F.header));
check('mobile question after WhatsApp', titles().indexOf('Mobile number (for calls)') === titles().indexOf('WhatsApp number') + 1, titles().slice(0, 5).join(' | '));
run('syncNow()');
check('mobile question not duplicated', titles().filter(t => t === 'Mobile number (for calls)').length === 1);

// ---- one web order mixing black and white and colour, with a mobile number
run(`(function(){ const st = settings_(); st.accepting_orders = true; st.hidden = { subjects: [], items: [] };
  st.print = [{ name: 'Black and white', price_per_page: 0.5, available: true }, { name: 'Colour', price_per_page: 3, available: true }];
  st.binding = [{ name: 'Stapled', price: 10, available: true }]; writeSettings_(st); })()`);
r = post({ ...order, print: 'Black and white', mobile: '01800000000', items: [
  { id: 'EEE475-2019-20-pack', copies: 1, print: 'Black and white' }, { id: 'EEE475-2019-20-pack', copies: 1, print: 'Colour' },
  { id: 'EEE443-2020-21-pack', copies: 2, print: 'Colour' }] });
const mixed = sheets.Orders.data.filter(x => x.length).slice(-3);
// 74 pages now: 74*0.5+10=47 ; 74*3+10=232 ; 58*3+10=184 x2=368
check('mixed order: a print type and price per line', r.ok && mixed.map(x => x[21] + ' ' + x[20]).join(',') === 'Black and white 47,Colour 232,Colour 368', mixed.map(x => x[21] + ' ' + x[20]).join(','));
check('mobile saved', mixed[0][22] === "'01800000000" && sheets.Orders.data[0][22] === 'Mobile');
check('no mobile: WhatsApp number used', post({ ...order, items: [{ id: 'EEE443-2020-21-pack', copies: 1 }] }).ok &&
  sheets.Orders.data.filter(x => x.length).slice(-1)[0][22] === "'01352679856");
check('bad mobile refused', /valid mobile/.test(post({ ...order, mobile: '12' }).error || ''));
check('a line with an unavailable print type refused', /print type/.test(post({ ...order, items: [{ id: 'EEE443-2020-21-pack', copies: 1, print: 'Gold' }] }).error || ''));

// ---- subject order: the page gets it, the form's subject questions follow it
run(`(function(){ const st = settings_(); st.subject_order = ['EEE475', 'EEE443']; writeSettings_(st); })()`);
check('page gets the subject order', JSON.stringify(JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings.subject_order) === '["EEE475","EEE443"]');
run('syncNow()');
const qs = titles().filter(t => /^EEE\d{3} /.test(t)).map(t => t.slice(0, 6));
check('form subject questions in the admin order', qs.join() === 'EEE475,EEE443,EEE329,EEE337,EEE421,EEE455,EEE459', qs.join());
check('they stay on the "Choose packs" page', titles().indexOf('Choose packs') < titles().indexOf(titles().find(t => t.startsWith('EEE475'))) &&
  titles().indexOf(titles().find(t => t.startsWith('EEE459'))) === titles().indexOf('Printing and payment') - 1);
ctx.__cache = {}; // the lockout test above left the admin locked
check('save refuses a malformed order', /subject order/.test(post({ action: 'adminSave', key, settings: Object.assign(run('settings_()'), { subject_order: 'x' }) }).error || ''));
console.log(fail ? fail + " FAILED" : "ALL PASS"); process.exitCode = fail ? 1 : 0;
