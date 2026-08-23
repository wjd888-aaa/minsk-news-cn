const { readFileSync, writeFileSync } = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tryGoogleapis(q) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) throw new Error('rate-limited');
  const d = await res.json();
  const parts = (Array.isArray(d) && Array.isArray(d[0]) ? d[0] : []).map((p) => (Array.isArray(p) && p[0] ? p[0] : '')).join('');
  if (!parts.trim()) throw new Error('empty');
  return parts.trim();
}

async function tryClients5(q) {
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=ru&tl=zh-CN&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const d = await res.json();
  if (Array.isArray(d)) return d.map((x) => (Array.isArray(x) ? x[0] : x)).join('');
  if (d && d.sentences) return d.sentences.map((s) => s.trans).join('');
  throw new Error('bad shape');
}

async function tryMymemory(q) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=ru|zh-CN`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const d = await res.json();
  if (d && d.responseData && d.responseData.translatedText) return d.responseData.translatedText;
  throw new Error('no data');
}

const CHANNELS = [tryGoogleapis, tryClients5, tryMymemory];
let preferred = 0;

async function translateChunk(q) {
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < CHANNELS.length; i++) {
      const ch = (preferred + i) % CHANNELS.length;
      try {
        const out = await CHANNELS[ch](q);
        preferred = ch;
        return out;
      } catch (e) {
        await sleep(600);
      }
    }
    await sleep(2000);
  }
  return '';
}

async function splitTranslate(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  const chunks = [];
  let cur = '';
  for (const s of t.split(/(?<=[.!?;…])\s*|\n+/).filter(Boolean)) {
    if (cur && (cur + ' ' + s).length > 1200) { chunks.push(cur); cur = s; }
    else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) chunks.push(cur);
  let out = '';
  for (const c of chunks) {
    const part = await translateChunk(c.slice(0, 1400));
    if (!part) return '';
    out += part;
    await sleep(700 + Math.random() * 500);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

async function main() {
  const ART = path.join(__dirname, '..', 'articles');

  const idx = JSON.parse(readFileSync(path.join(ART, 'index.json'), 'utf8'));
  let fixed = 0, fail = 0;
  for (const r of idx) {
    if (r.source === 'belta') continue;
    if (r.ru && (!r.zh || r.zh === r.ru)) {
      const zh = await splitTranslate(r.ru);
      if (zh) { r.zh = zh; fixed++; console.log('  [news] OK ' + r.slug.slice(0, 28)); }
      else { fail++; console.log('  [news] FAIL ' + r.slug.slice(0, 28)); }
    }
  }
  writeFileSync(path.join(ART, 'index.json'), JSON.stringify(idx, null, 2), 'utf8');
  console.log(`index.json: 修复 ${fixed}, 失败 ${fail}`);

  for (const file of ['deals.json', 'fastfoods.json']) {
    const arr = JSON.parse(readFileSync(path.join(ART, file), 'utf8'));
    let ok = 0, fail2 = 0;
    for (const d of arr) {
      if (!d.text) continue;
      if (!d.zh || d.zh === d.text) {
        const zh = await splitTranslate(d.text.slice(0, 1200));
        if (zh) { d.zh = zh; ok++; console.log('  [' + file + '] OK ' + d.store); }
        else { fail2++; console.log('  [' + file + '] FAIL ' + d.store); }
      }
    }
    writeFileSync(path.join(ART, file), JSON.stringify(arr, null, 2), 'utf8');
    console.log(`${file}: 修复 ${ok}, 失败 ${fail2}`);
  }
}

main().catch((e) => { console.error('REPAIR ERROR:', e.message); process.exit(1); });
