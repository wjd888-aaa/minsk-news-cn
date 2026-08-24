const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const path = require('path');

const ART = path.join(__dirname, '..', 'articles');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 三通道翻译（与 build.js 相同策略） ----------
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
      try { const out = await CHANNELS[ch](q); preferred = ch; return out; }
      catch (e) { await sleep(600); }
    }
    await sleep(2000);
  }
  return '';
}

// ---------- 复用 build.js 的解析器（直接 require 不可行，复制关键逻辑） ----------
function stripHtml(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function findDivBlock(html, classPart) {
  const openRe = new RegExp(`<div\\b[^>]*class="[^"]*${classPart}[^"]*"[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = m.index;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return { start: m.index, end: tagRe.lastIndex }; }
    else depth++;
  }
  return { start: m.index, end: html.length };
}
function divBlockAt(html, tagStart) {
  let depth = 0;
  const tagRe = /<\/?div\b[^>]*>/gi;
  tagRe.lastIndex = tagStart;
  let t;
  while ((t = tagRe.exec(html))) {
    if (t[0][1] === '/') { depth--; if (depth === 0) return { start: tagStart, end: tagRe.lastIndex }; }
    else depth++;
  }
  return { start: tagStart, end: html.length };
}
function minskRegion(html) {
  const h1 = html.search(/<h1[\s>]/i);
  const anchor = h1 > -1 ? h1 : 0;
  const s1 = html.indexOf('class="page-content"', anchor);
  if (s1 > -1) return divBlockAt(html, html.lastIndexOf('<div', s1));
  return findDivBlock(html, 'news-whole-post');
}
function extractMinskBody(html) {
  const region = minskRegion(html);
  if (!region) return [];
  const seg = html.slice(region.start, region.end);
  const STOP = /Читайте также|Подписывайтесь|Наш канал|Смотрите также/i;
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(seg))) {
    const t = stripHtml(m[1]);
    if (t.length > 15) {
      if (STOP.test(t)) break;
      paras.push(t);
    }
    if (paras.length >= 40) break;
  }
  return paras;
}
function extractMinskImages(html) {
  const h1 = html.search(/<h1[\s>]/i);
  const region = minskRegion(html);
  const from = h1 > -1 ? h1 : (region ? region.start : 0);
  let to = region ? region.end : html.length;
  const zone = html.slice(from, to);
  const stop = zone.search(/Читайте также|Подписывайтесь|Наш канал|Смотрите также/i);
  if (stop > -1) to = from + stop;
  return extractImageUrls(html.slice(from, to));
}
function extractImageUrls(seg) {
  const out = [];
  const re = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(seg)) && out.length < 6) {
    const u = (m[1] || '').trim();
    if (!u || /^data:/i.test(u) || /\.svg(\?|$)/i.test(u)) continue;
    if (/yandex|mc\.|pixel|tracker|informer|top-fwz1|mail\.ru/i.test(u)) continue;
    if (/banner|adfox|wpadcenter|adv\b/i.test(u)) continue;
    if (/logo|icon|favicon|avatar|desimages|dzen|google-logo|t-me|subscribe|social|share/i.test(u)) continue;
    if (/-80x80|-50x50|-150x130|\.thumbs\//i.test(u)) continue;
    if (out.includes(u)) continue;
    out.push(u);
  }
  return out;
}
function resolveUrl(u, base) {
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(u, base).href; } catch { return null; }
}
async function downloadArticleImages(urls, slug, base) {
  const dir = path.join(ART, 'imgs', slug);
  mkdirSync(dir, { recursive: true });
  const local = [];
  let i = 0, totalBytes = 0;
  for (const u of urls) {
    i++;
    const abs = resolveUrl(u, base);
    if (!abs) continue;
    try {
      const res = await fetch(abs, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 500 || totalBytes + buf.length > 4 * 1024 * 1024) continue;
      const ct = res.headers.get('content-type') || '';
      let ext = '.jpg';
      if (ct.includes('png')) ext = '.png';
      else if (ct.includes('webp')) ext = '.webp';
      else if (ct.includes('gif')) ext = '.gif';
      writeFileSync(path.join(dir, `img${i}${ext}`), buf);
      totalBytes += buf.length;
      local.push(`../imgs/${slug}/img${i}${ext}`);
      await sleep(150);
    } catch { continue; }
  }
  return local;
}
function extractBeltaBody(html) {
  const blk = findDivBlock(html, 'js-mediator-article');
  if (blk) {
    const seg = html.slice(blk.start, blk.end).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6])>/gi, '\n');
    const paras = seg.split('\n').map((x) => stripHtml(x)).filter((t) => t.length > 10);
    if (paras.length) return paras.slice(0, 30);
  }
  return [];
}
function beltaImages(html) {
  const r1 = html.match(/class="inner_content"([\s\S]*?)(?:class="rubricNews"|class="one_right_col"|<div class="clear")/);
  let seg = r1 ? r1[1] : '';
  const blk = findDivBlock(html, 'js-mediator-article');
  if (blk) seg += '\n' + html.slice(blk.start, blk.end);
  return extractImageUrls(seg || html);
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' } });
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.text();
}

async function main() {
  const max = Number(process.argv[2] || 20);
  const idx = JSON.parse(readFileSync(path.join(ART, 'index.json'), 'utf8'));
  const cutoff = Date.now() - 6 * 86400000;
  const catRank = { event: 0, volunteer: 1, news: 2, china: 3 };
  const candidates = idx
    .filter((r) => {
      if (!r.link) return false;
      let t = Date.parse(r.isodate);
      if (isNaN(t)) return false;
      if (t < cutoff) return false;
      if (r.body && r.body.length) return false;
      return true;
    })
    .sort((a, b) => (catRank[a.cat || 'news'] - catRank[b.cat || 'news']) || (Date.parse(b.isodate) - Date.parse(a.isodate)))
    .slice(0, max);

  console.log(`待补正文: ${candidates.length} 篇 (上限 ${max})`);
  let ok = 0, empty = 0, fail = 0;
  for (const r of candidates) {
    try {
      process.stdout.write(`  [${r.source === 'belta' ? 'belta' : 'mn'}] ${(r.zh || r.ru).slice(0, 26)} ... `);
      const html = await fetchHtml(r.link);
      let body = [], imgs = [];
      if (r.source === 'belta') {
        body = extractBeltaBody(html);
        const dl = await downloadArticleImages(beltaImages(html), r.slug, r.link);
        imgs = dl.local;
        r.image_srcs = dl.srcs;
      } else {
        const ruParas = extractMinskBody(html);
        const dl2 = await downloadArticleImages(extractMinskImages(html), r.slug, r.link);
        imgs = dl2.local;
        r.image_srcs = dl2.srcs;
        for (const p of ruParas) {
          const zh = await translateChunk(p);
          if (zh) body.push(zh);
          await sleep(500 + Math.random() * 400);
        }
      }
      r.body = body;
      r.images = imgs;
      if (body.length) { ok++; console.log(`正文${body.length}段 图${imgs.length}`); }
      else { empty++; console.log(`正文0段 图${imgs.length}`); }
    } catch (e) {
      fail++; console.log('抓取失败: ' + e.message);
    }
    writeFileSync(path.join(ART, 'index.json'), JSON.stringify(idx, null, 2), 'utf8');
    await sleep(800);
  }
  console.log(`完成: 有正文 ${ok}, 0段 ${empty}, 失败 ${fail}`);
}

main().catch((e) => { console.error('BACKFILL ERROR:', e.message); process.exit(1); });
