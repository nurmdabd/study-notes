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
  FormApp: { ItemType: { MULTIPLE_CHOICE: 'MC' }, openById: () => { throw new Error('no form'); } },
};
vm.createContext(ctx); vm.runInContext(code, ctx);
const run = s => vm.runInContext(s, ctx);
const post = obj => JSON.parse(run(`doPost({postData:{contents:${JSON.stringify(JSON.stringify(obj))}}})`).body);
let fail = 0; const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) fail++; };

props.SHEET_ID = 'SHEET';
run(`setupOrdersSheet_(ss_()); writeCatalogueSheet_(ss_(), fetchCatalogue_()); showAdminKey();`);
const key = props.ADMIN_KEY;
check('admin key made', /^[0-9a-f]{16}$/.test(key), key);
const g = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body);
check('settings via doGet', g.ok && g.settings.binding.length === 1 && g.settings.binding[0].name === 'Stapled', JSON.stringify(g.settings.binding));
check('Settings tab keeps spiral, unavailable', JSON.stringify(run('settings_()').binding).includes('"Spiral binding"'));
check('ping', JSON.parse(run('doGet({parameter:{}})').body).service === 'study-notes print orders');

const order = { name: 'A', studentId: '1', phone: '01352679856', binding: 'Stapled', pickup: g.settings.pickup[0], payment: 'bKash',
  items: [{ id: 'EEE475-2019-20-pack', copies: 2 }, { id: 'EEE421-2020-21-pack', copies: 1 }] };
let r = post(order);
check('order accepted', r.ok && /^SN-261019-/.test(r.orderId), JSON.stringify(r));
const rows = sheets.Orders.data.slice(1).filter(x => x.length);
check('two rows written', rows.length === 2, rows.map(x => x[11] + ' x' + x[12] + ' est=' + x[20]).join('; '));
check('default dept/batch', rows[0][5] === 'EEE' && rows[0][6] === '2021-22');
check('no estimate while price 0', rows[0][20] === '');
check('spiral refused', post({ ...order, binding: 'Spiral binding' }).error === 'That binding is not available now.');
check('unknown pack refused', /Unknown pack/.test(post({ ...order, items: [{ id: 'X', copies: 1 }] }).error));
check('bad phone refused', /valid phone/.test(post({ ...order, phone: '123' }).error));
check('spam bot ignored', post({ ...order, website: 'x' }).orderId === 'SN-0');

check('wrong key refused', post({ action: 'adminLoad', key: 'nope' }).error === 'Wrong admin key.');
const L = post({ action: 'adminLoad', key });
check('admin load', L.ok && L.sheet && L.settings.price_note.startsWith('At printing cost'));
const st = L.settings; st.price_per_page = 0.6; st.show_estimate = true; st.binding[1].available = true; st.binding[1].price = 30;
let S = post({ action: 'adminSave', key, settings: st });
check('admin save', S.ok && S.settings.price_per_page === 0.6, S.error || '');
const g2 = JSON.parse(run(`doGet({parameter:{action:'settings'}})`).body).settings;
check('page sees new price and spiral', g2.price_per_page === 0.6 && g2.binding.length === 2 && g2.show_estimate, JSON.stringify(g2.binding));
r = post({ ...order, binding: 'Spiral binding' });
const last = sheets.Orders.data.filter(x => x.length).slice(-2);
// 70 pages*0.6+30 = 72 per copy *2 = 144 ; 118*0.6+30=100.8 -> 101
check('estimate saved', r.ok && last[0][20] === 144 && last[1][20] === 101, last.map(x => x[20]).join(','));
st.binding.forEach(b => { b.available = false; });
check('save refuses no binding', /At least one binding/.test(post({ action: 'adminSave', key, settings: st }).error));
st.binding[0].available = true; st.accepting_orders = false;
post({ action: 'adminSave', key, settings: st });
check('paused refuses orders', /paused/.test(post(order).error));
for (let i = 0; i < 10; i++) post({ action: 'adminLoad', key: 'bad' });
check('lockout after 10 wrong keys', /Too many/.test(post({ action: 'adminLoad', key }).error));
check('emails sent per order', ctx.__mail.length === 2, ctx.__mail.length);
console.log(fail ? fail + " FAILED" : "ALL PASS"); process.exitCode = fail ? 1 : 0;
