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

// ---- a mock Google Form (the script now only retires the old one, in removeForm). Like Google's: a question
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

// ---- setup and upgrade (no form any more), payment details, a pack whose page count changed
ctx.__mail.length = 0;
run(`(function(){ const st = settings_(); st.accepting_orders = true; st.hidden = { subjects: [], items: [] };
  st.print = [{ name: 'Black and white', price_per_page: 0.5, available: true }]; writeSettings_(st); })()`);
run('setup()');
check('setup makes no form', !ctx.__form && !props.FORM_ID);
run('upgrade()');
check('upgrade wrote all order headers', sheets.Orders.data[0][21] === 'Print' && sheets.Orders.data[0][19] === 'Status' && sheets.Orders.data[0][22] === 'Mobile');
check('catalogue tab has no form-link column', sheets.Catalogue.data[0].length === 9 && sheets.Catalogue.data[0][8] === 'Download', sheets.Catalogue.data[0].join());
run(`(function(){ const st = settings_(); st.payment = [{ name: 'Cash at pickup', available: true },
  { name: 'bKash', details: '01352679856 (personal, Send Money)', available: true }, { name: 'Nagad', details: '01700000000', available: false }];
  writeSettings_(st); })()`);
const gp = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings;
check('page gets payment details of available methods only', JSON.stringify(gp.payment_details) === '{"bKash":"01352679856 (personal, Send Money)"}', JSON.stringify(gp.payment_details));
check('no google_form in the page settings', !('google_form' in gp));
const catText = ctx.UrlFetchApp.fetch().getContentText();
const grown = JSON.parse(catText); grown.items.find(i => i.id === 'EEE475-2019-20-pack').pages = 74;
ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(grown) });
run('syncNow()');
check('catalogue tab has the new page count', run('catalogueById_()')['EEE475-2019-20-pack'].pages === 74);

// ---- removeForm: the old form is unlinked and trashed, its properties dropped, only the hourly trigger left
ctx.__form = makeForm(); props.FORM_ID = 'F'; props.SUBJECT_ITEMS = '{}'; props.CHOICE_MAP = '{}';
let unlinked = false, trashed = '';
const realOpen = ctx.FormApp.openById;
ctx.FormApp.openById = () => Object.assign(Object.create(null), { removeDestination: () => { unlinked = true; } });
ctx.DriveApp = { getFileById: id => ({ setTrashed: v => { trashed = id + ':' + v; } }) };
const made = [];
ctx.ScriptApp = { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: name => { made.push(name); return chain(); } };
run('removeForm()');
check('form unlinked and trashed', unlinked && trashed === 'F:true');
check('form properties removed', !props.FORM_ID && !props.SUBJECT_ITEMS && !props.CHOICE_MAP);
check('only the hourly catalogue trigger is made', made.join() === 'syncNow', made.join());
ctx.FormApp.openById = realOpen; delete ctx.__form;
run('removeForm()'); // again, with no form: no error
check('removeForm is safe to run twice', true);

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

// ---- subject order: the page gets it
run(`(function(){ const st = settings_(); st.subject_order = ['EEE475', 'EEE443']; writeSettings_(st); })()`);
check('page gets the subject order', JSON.stringify(JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings.subject_order) === '["EEE475","EEE443"]');
ctx.__cache = {}; // the lockout test above left the admin locked
check('save refuses a malformed order', /subject order/.test(post({ action: 'adminSave', key, settings: Object.assign(run('settings_()'), { subject_order: 'x' }) }).error || ''));
console.log(fail ? fail + " FAILED" : "ALL PASS"); process.exitCode = fail ? 1 : 0;
