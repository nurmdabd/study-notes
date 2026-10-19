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

// ---- a mock Google Form, for setup, upgrade, the form sync and form orders
function makeForm() {
  let next = 1; const items = [];
  const item = (type, extra = {}) => {
    const it = { id: next++, type, title: '', choices: [], getId() { return this.id; }, getTitle() { return this.title; },
      getIndex() { return items.indexOf(this); }, getType() { return this.type; } };
    const self = new Proxy(it, { get: (t, k) => {
      if (k in t) return t[k];
      if (k === 'setTitle') return v => { t.title = v; return self; };
      if (k === 'setChoiceValues') return v => { t.choices = v.slice(); return self; };
      if (k === 'asCheckboxItem' || k === 'asMultipleChoiceItem') return () => self;
      if (k === 'createResponse') return v => ({ item: t, v });
      return () => self;
    } });
    items.push(self); return self;
  };
  const form = new Proxy({ items }, { get: (t, k) => {
    if (k === 'items') return items;
    if (k === 'getId') return () => 'F';
    if (k === 'getPublishedUrl') return () => 'https://forms/F/viewform';
    if (k === 'getEditUrl') return () => 'https://forms/F/edit';
    if (k === 'getItems') return type => items.filter(i => !type || i.type === type);
    if (k === 'getItemById') return id => items.find(i => i.id === id) || null;
    if (k === 'deleteItem') return i => { items.splice(items.indexOf(i), 1); };
    if (k === 'moveItem') return (from, to) => { const [i] = items.splice(from, 1); items.splice(to, 0, i); };
    if (k === 'createResponse') return () => { const r = { parts: [] }; r.withItemResponse = x => { r.parts.push(x); return r; }; r.toPrefilledUrl = () => 'https://forms/F/prefill?' + r.parts.map(x => x.v.join(',')).join('&'); return r; };
    const add = { addTextItem: 'TEXT', addParagraphTextItem: 'PARA', addListItem: 'LIST', addPageBreakItem: 'PB',
      addCheckboxItem: 'CHECKBOX', addMultipleChoiceItem: 'MC' }[k];
    if (add) return () => item(add);
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
  FormApp: { ItemType: { MULTIPLE_CHOICE: 'MC' }, DestinationType: { SPREADSHEET: 'S' },
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
const titles = () => F.items.map(i => i.title);
check('setup made a form with the Print question', titles().includes('Print') && titles().indexOf('Print') < titles().indexOf('Binding'), titles().join(' | '));
check('form options from settings', F.items.find(i => i.title === 'Binding').choices.join() === 'Stapled');
// a form made before "Print" existed
F.deleteItem(F.items.find(i => i.title === 'Print'));
run(`(function(){ const st = settings_(); st.print.push({ name: 'Colour', price_per_page: 3, available: true });
  st.hidden = { subjects: ['EEE337'], items: ['EEE475-2020-21-pack'] }; writeSettings_(st); })()`);
run('upgrade()');
F = ctx.__form;
const pq = F.items.find(i => i.title === 'Print');
check('upgrade adds Print before Binding', pq && titles().indexOf('Print') === titles().indexOf('Binding') - 1 && pq.choices.join() === 'Black and white,Colour', titles().join(' | '));
check('upgrade wrote all order headers', sheets.Orders.data[0][21] === 'Print' && sheets.Orders.data[0][19] === 'Status');
check('hidden subject has no question', !titles().some(t => t.startsWith('EEE337')));
const rf = F.items.find(i => i.title.startsWith('EEE475'));
check('hidden pack not offered', rf && rf.choices.length === 1 && rf.choices[0].startsWith('2019-20'), rf && rf.choices.join());
// a form response
const resp = (title, v) => ({ getItem: () => F.items.find(i => i.title === title), getResponse: () => v });
const before = sheets.Orders.data.filter(x => x.length).length;
run('handleFormSubmit')( { response: { getTimestamp: () => new Date(), getItemResponses: () => [
  resp('Name', 'Form User'), resp('Student ID', '9'), resp('WhatsApp number', '01700000000'),
  resp(rf.title, [rf.choices[0]]), resp('Copies of each pack', '2'), resp('Print', 'Colour'),
  resp('Binding', 'Stapled'), resp('Pickup', 'On campus (place confirmed on WhatsApp)'), resp('Payment', 'Cash at pickup') ] } });
const fr = sheets.Orders.data.filter(x => x.length).slice(-1)[0];
check('form order row: pack, copies, colour, estimate', sheets.Orders.data.filter(x => x.length).length === before + 1 &&
  fr[2] === 'Form' && fr[11] === 'EEE475-2019-20-pack' && fr[12] === 2 && fr[21] === 'Colour' && fr[20] === 420, fr.slice(2, 22).join(' / '));
console.log(fail ? fail + " FAILED" : "ALL PASS"); process.exitCode = fail ? 1 : 0;
