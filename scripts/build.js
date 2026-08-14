const { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, appendFileSync } = require('fs');
const path = require('path');

const RSS_URL = 'https://minsknews.by/feed/';
const FETCH_INTERVAL_MS = 23 * 60 * 60 * 1000;
const MAX_ITEMS = 40;
const MAX_FULLTEXT = 20;
const HOMEPAGE_RECENT = 50;

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const ART_DIR = path.join(ROOT, 'articles');
const INDEX_FILE = path.join(ART_DIR, 'index.json');
const LAST_RUN_FILE = path.join(ART_DIR, 'last_fetch.json');
const CSS_SRC = path.join(ROOT, 'public', 'style.css');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function translate(text) {
  if (!text || !text.trim()) return '';
  const q = encodeURIComponent(text.trim().slice(0, 4800));
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=zh-CN&dt=t&q=${q}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error('http ' + res.status);
      const data = await res.json();
      const parts = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : [])
        .map((p) => (Array.isArray(p) && p[0] ? p[0] : ''))
        .join('');
      if (parts.trim()) return parts.trim();
      throw new Error('empty result');
    } catch (e) {
      if (attempt === 3) break;
      await sleep([1000, 2500][attempt - 1] || 1000);
    }
  }
  return '';
}

function parseFeed(xml) {
  const blocks = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  return blocks;
}

function field(block, name) {
  const r = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(r);
  return m ? m[1] : '';
}

function fmtBeijing(dateString) {
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const bj = new Date(d.getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${bj.getUTCFullYear()}-${p(bj.getUTCMonth() + 1)}-${p(bj.getUTCDate())} ${p(bj.getUTCHours())}:${p(bj.getUTCMinutes())}`;
}

function slugFromUrl(url) {
  let last = '';
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '');
    last = p.split('/').pop() || '';
  } catch {
    last = '';
  }
  let slug = last;
  try { slug = decodeURIComponent(last); } catch {}
  slug = slug
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
  return slug || 'article-' + Math.random().toString(36).slice(2, 8);
}

function extractArticleBody(html) {
  const s1 = html.indexOf('class="page-content"');
  if (s1 < 0) return [];
  let s2 = html.indexOf('class="page-content"', s1 + 30);
  let end = html.length;
  if (s2 > s1) end = s2;
  else {
    const a = html.indexOf('<aside', s1);
    const f = html.indexOf('<footer', s1);
    const candidates = [a, f].filter((x) => x > s1);
    if (candidates.length) end = Math.min(...candidates);
  }
  const seg = html.slice(s1, end);
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(seg))) {
    const t = stripHtml(m[1]);
    if (t.length > 15) paras.push(t);
  }
  return paras;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function nowBeijing() {
  const now = new Date(new Date().getTime() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())} ${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`;
}

function articlePageHtml(rec) {
  let bodyHtml;
  if (rec.body && rec.body.length) {
    bodyHtml = rec.body.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  } else {
    bodyHtml = `<p>${escapeHtml(rec.sum || rec.zh)} <a href="${escapeHtml(rec.link)}" target="_blank" rel="noopener noreferrer">查看俄语原文全文 ↗</a></p>
<p class="note">本文尚无全文译文，请看摘要或原文。</p>`;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(rec.zh)} · 白俄新闻中文站</title>
<meta name="description" content="${escapeHtml((rec.sum || rec.zh).slice(0, 160))}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="../style.css">
</head>
<body>
<nav class="crumb"><a href="../index.html">← 返回首页</a></nav>
<header class="site-head article-head">
  <h1>${escapeHtml(rec.zh)}</h1>
  <div class="ru">${escapeHtml(rec.ru)}</div>
  <div class="meta">● ${escapeHtml(rec.beijing)}（北京时间）· <a href="${escapeHtml(rec.link)}" target="_blank" rel="noopener noreferrer">查看俄语原文 ↗</a></div>
</header>
<main class="article-body">
${bodyHtml}
</main>
<footer class="site-foot">
  <p>本文由机器自动翻译，可能存在不准确之处，仅供学习交流。</p>
  <p><a href="../index.html">← 返回首页</a></p>
</footer>
</body>
</html>
`;
}

function homepageHtml(records, updated) {
  const cards = records
    .map(
      (c) => `<article class="card">
  <h2 class="ttl"><a href="article/${encodeURIComponent(c.slug)}.html">${escapeHtml(c.zh)}</a></h2>
  <div class="ru">${escapeHtml(c.ru)}</div>
  ${(c.sum || '').length > 1 ? `<p class="sum">${escapeHtml(c.sum.slice(0, 160))} <a class="more" href="article/${encodeURIComponent(c.slug)}.html">阅读全文 ↗</a></p>` : ''}
  <div class="meta">● ${escapeHtml(c.beijing)}（北京时间） · <a href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>
</article>`
    )
    .join('\n');

  const recent = records.slice(0, HOMEPAGE_RECENT);
  const older = records.slice(HOMEPAGE_RECENT);
  let olderHtml = '';
  if (older.length) {
    const list = older
      .map((o) => `<li><a href="article/${encodeURIComponent(o.slug)}.html">${escapeHtml(o.zh)}</a> <span class="old-date">${escapeHtml(o.beijing)}</span></li>`)
      .join('\n');
    olderHtml = `<details class="archive"><summary>更早的新闻（${records.length - recent.length} 篇）</summary>
<ul>${list}</ul></details>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白俄新闻中文站 · 白俄罗斯新闻中文明日速览</title>
<meta name="description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克最新新闻，每 23 小时更新，按北京时间显示，点击标题查看中文全文。">
<meta property="og:type" content="website">
<meta property="og:site_name" content="白俄新闻中文站">
<meta property="og:title" content="白俄新闻中文站 · 白俄罗斯新闻中文明日速览">
<meta property="og:description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克最新新闻，每 23 小时更新，点击标题看中文全文。">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="style.css">
</head>
<body>
<header class="site-head">
  <h1>白俄新闻<span class="accent">中文站</span></h1>
  <p class="sub">白俄罗斯 &amp; 明斯克最新新闻 · 自动翻译自 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">minsknews.by</a> · 每 23 小时更新</p>
  <p class="updated">更新于 ${updated}（北京时间）· 收录 ${records.length} 篇</p>
</header>
<main>
${cards}
${olderHtml}
</main>
<footer class="site-foot">
  <p>本站由机器自动抓取并翻译新闻，仅供学习交流，版权归原始来源 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">«Минск-новости»</a> 所有。</p>
  <p>时间均为北京时间 · <a href="https://github.com/wjd888-aaa/minsk-news-cn" target="_blank" rel="noopener noreferrer">开源项目</a></p>
</footer>
</body>
</html>
`;
}

async function main() {
  // ---- 1. 23h gate ----
  const lastRun = readJson(LAST_RUN_FILE, null);
  if (lastRun && lastRun.ts && Date.now() - lastRun.ts < FETCH_INTERVAL_MS) {
    const left = Math.ceil((FETCH_INTERVAL_MS - (Date.now() - lastRun.ts)) / 3600000);
    console.log(`SKIP: 距上次抓取不足 23 小时，${left} 小时后再次检查。`);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, 'skipped=true\n');
    }
    process.exit(0);
  }
  console.log('Fetching RSS from ' + RSS_URL);
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('RSS http ' + res.status);
  const xml = await res.text();
  const blocks = parseFeed(xml);
  console.log('Parsed items: ' + blocks.length);
  if (!blocks.length) throw new Error('no items parsed');

  // ---- 2. load existing index ----
  let index = readJson(INDEX_FILE, []);
  const byLink = new Map(index.map((r) => [r.link, r]));

  // ---- 3. collect new records ----
  const newRecords = [];
  for (const b of blocks.slice(0, MAX_ITEMS)) {
    const link = field(b, 'link').trim();
    if (byLink.has(link)) continue;
    const ru = stripHtml(field(b, 'title'));
    if (!ru) continue;
    const isodate = field(b, 'pubDate').trim();
    newRecords.push({
      slug: slugFromUrl(link),
      link,
      ru,
      isodate,
      beijing: fmtBeijing(isodate),
    });
  }
  console.log('New articles: ' + newRecords.length);

  // ---- 4. translate new records (title + summary) ----
  for (const rec of newRecords) {
    const desc = stripHtml(field(blocks.find((b) => field(b, 'link').trim() === rec.link) || '', 'description'));
    process.stdout.write(`  title: ${rec.ru.slice(0, 40)} ... `);
    rec.zh = (await translate(rec.ru)) || rec.ru;
    rec.sum = desc ? (await translate(desc.slice(0, 700))) || '' : '';
    console.log('done');
    await sleep(200 + Math.random() * 200);
  }

  // ---- 5. full text for up to MAX_FULLTEXT newest ----
  let fulltextDone = 0;
  for (const rec of newRecords) {
    if (fulltextDone >= MAX_FULLTEXT) break;
    process.stdout.write(`  body: ${rec.ru.slice(0, 40)} ... `);
    try {
      const pr = await fetch(rec.link, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      if (pr.ok) {
        const html = await pr.text();
        const paras = extractArticleBody(html);
        rec.body = [];
        for (const p of paras.slice(0, 40)) {
          const zh = await translate(p);
          if (zh) rec.body.push(zh);
          await sleep(200 + Math.random() * 200);
        }
        if (rec.body.length) fulltextDone++;
        console.log(`done (${rec.body.length} 段)`);
      } else {
        rec.body = [];
        console.log('http ' + pr.status);
      }
    } catch (e) {
      rec.body = [];
      console.log('fetch fail');
    }
  }

  // ---- 6. merge into index, sort desc ----
  for (const rec of newRecords) byLink.set(rec.link, rec);
  const records = [...byLink.values()].sort((a, b) => new Date(b.isodate) - new Date(a.isodate));

  // ---- 7. write article pages + persist ----
  mkdirSync(ART_DIR, { recursive: true });
  for (const rec of newRecords) {
    writeFileSync(path.join(ART_DIR, `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
  }
  writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2), 'utf8');
  writeFileSync(LAST_RUN_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }), 'utf8');

  // ---- 8. build site ----
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(path.join(OUT_DIR, 'article'), { recursive: true });
  const updated = nowBeijing();
  writeFileSync(path.join(OUT_DIR, 'index.html'), homepageHtml(records, updated), 'utf8');
  for (const rec of records) {
    try {
      writeFileSync(path.join(OUT_DIR, 'article', `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
    } catch {
      continue;
    }
  }
  copyFileSync(CSS_SRC, path.join(OUT_DIR, 'style.css'));

  console.log(`DONE: 共 ${records.length} 篇，本次新增 ${newRecords.length} 篇（全文 ${fulltextDone} 篇）。`);
}

main().catch((e) => {
  console.error('BUILD ERROR:', e.message);
  process.exit(1);
});