const { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync, appendFileSync } = require('fs');
const path = require('path');

const RSS_URL = 'https://minsknews.by/feed/';
const FETCH_INTERVAL_MS = 23 * 60 * 60 * 1000;
const MAX_ITEMS = 120;
const MAX_FULLTEXT = 20;
const HOMEPAGE_RECENT = 60;

const PARENT_LINK =
  '<div class="topbar"><a href="https://minsktc.me" target="_blank" rel="noopener noreferrer">明斯克同城 minsktc.me ↗</a></div>';

const EVENT_KEYS = [
  'выставк', 'концерт', 'фестивал', 'спектакл', 'форум', 'ярмарк', 'премьер',
  'показ', 'встреч', 'мастер-класс', 'экскурси', 'кино', 'лекци',
  'конференция', 'турнир', 'соревновани', 'экспозиц', 'праздник',
  'музей', 'театр', 'афиша', 'конкурс', 'олимпиад', 'день открытых', 'концертн'
];
const VOLUNTEER_KEYS = [
  'волонтёр', 'волонтер', 'донор', 'благотворит', 'добровольц', 'красный крест',
  'гуманитарн', 'субботник', 'приют', 'пожертвова', 'безвозмездн', 'нуждающ'
];
const CHINA_KEYS = [
  'китай', 'кнр', 'си цзиньпин', 'шанхайск', 'поднебесн', 'белорусско-китай', 'китайско-белорусск'
];
const CAT_LABEL = { news: '新闻', event: '活动', volunteer: '志愿者', china: '中白' };
const CAT_RANK = { volunteer: 0, event: 1, china: 2, news: 3 };

const STORE_ZH = {
  Green: '绿超市',
  'Евроопт': '欧罗超市',
  'АЛМИ': '阿尔米',
  'Хит': '嗨特',
  'Гиппо': '吉波',
  'Копеечка': '小零钱',
  'Грошык': '格罗什克',
  'Санта': '圣诞超市',
  'Fix Price': '固价超市',
  'Корона': '皇冠超市',
  'UniStore': '尤尼斯特',
  'Три цены': '三价超市',
  'Дионис': '迪奥尼斯',
  'ПерекрестОК': '十字路口',
};
const zhStore = (s) => STORE_ZH[s] || s;

const DEAL_CHANNELS = [
  { user: 'shopsgreen', store: 'Green' },
  { user: 'evroopt_shop', store: 'Евроопт' },
  { user: 'almi_by', store: 'АЛМИ' },
  { user: 'hitdiscount_by', store: 'Хит' },
  { user: 'gippoby_offical', store: 'Гиппо' },
  { user: 'kopeechka_by', store: 'Копеечка' },
  { user: 'groshyk', store: 'Грошык' },
  { user: 'santaretail_by', store: 'Санта' },
  { user: 'fixprice_by', store: 'Fix Price' },
  { user: 'koronaby', store: 'Корона' },
  { user: 'unistoreminsk', store: 'UniStore' },
];
const DEAL_DAYS = 30;
const DEAL_MAX = 100;

const DEAL_PAGES = [
  { id: 'triceny', store: 'Три цены', url: 'https://3ceni.by/sales/', parse: parse3CeniSales, limit: 8 },
  { id: 'dionis', store: 'Дионис', url: 'https://dionis-shop.by/promotions', parse: parseDionisPromos, limit: 8 },
  { id: 'perekrestok', store: 'ПерекрестОК', url: 'https://perekrestok24.by/discounts/', parse: parsePerekrestokDiscounts, limit: 8, enrich: fetchPerekrestokPeriod },
];

function classify(text) {
  const t = String(text || '').toLowerCase();
  for (const k of VOLUNTEER_KEYS) if (t.includes(k)) return 'volunteer';
  for (const k of EVENT_KEYS) if (t.includes(k)) return 'event';
  for (const k of CHINA_KEYS) if (t.includes(k)) return 'china';
  return 'news';
}

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'out');
const ART_DIR = path.join(ROOT, 'articles');
const INDEX_FILE = path.join(ART_DIR, 'index.json');
const LAST_RUN_FILE = path.join(ART_DIR, 'last_fetch.json');
const DEALS_FILE = path.join(ART_DIR, 'deals.json');
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

const WMO_DESC = {
  0: ['☀️', '晴'], 1: ['🌤', '基本晴'], 2: ['⛅', '多云'], 3: ['☁️', '阴'],
  45: ['🌫', '雾'], 48: ['🌫', '雾凇'], 51: ['🌦', '毛毛雨'], 53: ['🌦', '毛毛雨'], 55: ['🌧', '小毛毛雨'],
  61: ['🌧', '小雨'], 63: ['🌧', '中雨'], 65: ['🌧', '大雨'], 66: ['🌧', '冻雨'], 67: ['🌧', '冻雨'],
  71: ['🌨', '小雪'], 73: ['🌨', '中雪'], 75: ['❄️', '大雪'], 77: ['❄️', '雪粒'],
  80: ['🌦', '阵雨'], 81: ['🌧', '阵雨'], 82: ['⛈', '强阵雨'], 85: ['🌨', '阵雪'], 86: ['❄️', '强阵雪'],
  95: ['⛈', '雷雨'], 96: ['⛈', '雷雨冰雹'], 99: ['⛈', '强雷雨冰雹']
};

function wmo(code, fallback) {
  const d = WMO_DESC[code] || fallback;
  return d[0];
}

async function fetchWeather() {
  try {
    const url =
      'https://api.open-meteo.com/v1/forecast?latitude=53.9&longitude=27.5667' +
      '&current=temperature_2m,apparent_temperature,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,weather_code' +
      '&forecast_days=5&timezone=Europe%2FMinsk';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('weather http ' + res.status);
    const j = await res.json();
    const cur = j.current || {};
    const d = j.daily || {};
    const nowDesc = WMO_DESC[cur.weather_code] || ['🌡', ''];
    const days = (d.time || []).slice(0, 4).map((t, i) => {
      const code = (d.weather_code || [])[i];
      const em = wmo(code, ['&#9679;']);
      const day = String(t).slice(5).replace('-', '/');
      return `${em} ${day} ${Math.round(d.temperature_2m_min[i])}~${Math.round(d.temperature_2m_max[i])}°`;
    });
    return `📍 明斯克天气 ${nowDesc[0]} ${Math.round(cur.temperature_2m)}°（体感 ${Math.round(cur.apparent_temperature)}°）${nowDesc[1]} · ${days.join(' ')}`;
  } catch (e) {
    console.log('weather fetch fail: ' + e.message);
    return '';
  }
}

async function fetchRates() {
  try {
    const url = 'https://api.nbrb.by/exrates/rates?periodicity=0';
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error('rates http ' + res.status);
    const list = await res.json();
    const want = ['USD', 'CNY', 'RUB', 'EUR'];
    const parts = [];
    for (const w of want) {
      const r = list.find((x) => x.Cur_Abbreviation === w && x.Cur_Scale);
      if (!r) continue;
      const rate = Number(r.Cur_OfficialRate);
      const scale = Number(r.Cur_Scale);
      const one = rate / scale;
      parts.push(`${scale} ${w} = ${rate.toFixed(2)} BYN`);
    }
    return `🇧🇾 白央行汇率 ` + parts.join(' · ');
  } catch (e) {
    console.log('rates fetch fail: ' + e.message);
    return '';
  }
}

function parse3CeniSales(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/sale\/[a-z0-9-]+\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (seen.has(slug)) continue;
    const text = stripHtml(m[2]);
    if (!text) continue;
    seen.add(slug);
    const periodM = text.match(/(?:с|С)\s*(\d{1,2})\s+по\s+(\d{1,2})\s+([а-яё]+)/);
    out.push({
      id: slug,
      link: 'https://3ceni.by' + m[1],
      text,
      period: periodM ? `с ${periodM[1]} по ${periodM[2]} ${periodM[3]}` : '',
    });
  }
  return out;
}

function parseDionisPromos(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<div class="swiper-slide">([\s\S]*?)<\/a>\s*<\/div>\s*<\/div>/g)) {
    const block = m[1];
    const hrefM = block.match(/href='(https:\/\/dionis-shop\.by\/promotions\/[a-z0-9-]+)'/);
    const titleM = block.match(/<div class="title">([^<]*)<\/div>/);
    if (!hrefM || !titleM) continue;
    const slug = hrefM[1].split('/').pop();
    if (seen.has(slug)) continue;
    const text = stripHtml(titleM[1]);
    const dateM = block.match(/<div class="date">([^<]*)<\/div>/);
    if (!text || text.includes('Полоцк')) continue;
    seen.add(slug);
    out.push({
      id: slug,
      link: hrefM[1],
      text,
      period: dateM ? dateM[1].trim() : '',
    });
  }
  return out;
}

function parsePerekrestokDiscounts(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href="(\/discounts\/[a-z0-9-]+\/)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = m[1].replace(/^\/|\/$/g, '');
    if (seen.has(slug)) continue;
    const text = stripHtml(m[2]);
    if (!text) continue;
    seen.add(slug);
    const periodM = text.match(/(?:с|С)\s*(\d{1,2}(?:\s+[а-яё]+)?)\s+по\s+(\d{1,2}(?:\s+[а-яё]+)?)/);
    out.push({
      id: slug,
      link: 'https://perekrestok24.by' + m[1],
      text,
      period: periodM ? `с ${periodM[1]} по ${periodM[2]}` : '',
    });
  }
  return out;
}

async function fetchPerekrestokPeriod(it) {
  try {
    const res = await fetch(it.link, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!res.ok) return it;
    const html = await res.text();
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
    if (h1) it.text = stripHtml(h1);
    const p =
      (html.match(/с\s+\d{1,2}(?:\s+[а-яё]+)?\s+по\s+\d{1,2}(?:\s+[а-яё]+)?/i) || [])[0] ||
      (html.match(/\d{1,2}\.\d{2}\.\d{4}\s*[-–]\s*\d{1,2}\.\d{2}\.\d{4}/) || [])[0] ||
      '';
    if (p) it.period = p;
  } catch (e) {
    // keep listing item as-is
  }
  return it;
}

function extractDealFields(text, period) {
  const t = String(text || '');
  const out = { price: null, priceUnit: '', oldPrice: null, discount: null, endDate: '' };
  if (!t) return out;
  const num = (s) => (s ? Number(s.replace(',', '.')) : null);
  const oldM = t.match(/вместо\s+(\d{1,4}[.,]\d{2})/i);
  if (oldM) out.oldPrice = num(oldM[1]);
  const discM = t.match(/(?:скидк[а-яё]*\s+(?:до\s+)?)?[-−]?\s*(\d{1,3})\s*%/i);
  if (discM) out.discount = Number(discM[1]);
  const months = /(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)/i;
  const re = /(\d{1,4}[.,]\d{2})(?!\d)/gi;
  for (const m of t.matchAll(re)) {
    if (oldM && m[1] === oldM[1]) continue;
    const day = parseInt(m[1], 10);
    const head = t.slice(Math.max(0, m.index - 26), m.index);
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 26);
    const unitM = t.slice(m.index + m[0].length, m.index + m[0].length + 12).match(/\/кг|за\s*кг|\/шт|за\s*шт|\/л|за\s*л|кг|шт|литр/);
    const unit = unitM ? unitM[0].replace(/за\s+/, '/') : '';
    const isDate =
      day <= 31 &&
      !unit &&
      (/\.\d{2,4}/.test(tail) ||
        /(?:по|до|с)\s+\d{1,2}[.,]\d{2}/.test(tail) ||
        /(?:с|по|до)\s+\d{1,2}[.,]\d{2}/.test(head) ||
        months.test(tail.slice(0, 14)) ||
        months.test(head.slice(-14)));
    if (isDate) continue;
    out.price = num(m[1]);
    out.priceUnit = unit;
    break;
  }
  const src = String(period || text || '');
  const full = src.match(/\d{1,2}\s+[а-яё]+\s+\d{4}/gi);
  if (full && full.length) out.endDate = full[full.length - 1];
  else {
    const rel = src.match(/(?:по|до)\s+(\d{1,2}\s+[а-яё]+)/i);
    if (rel) out.endDate = rel[1];
    else {
      const dotted = src.match(/(\d{1,2}\.\d{2}(?:\.\d{4})?)\s*$/);
      if (dotted) out.endDate = dotted[1];
    }
  }
  return out;
}

function parseTelegramPage(html) {
  const out = [];
  const posts = [];
  const rePost = /data-post="([\w-]+\/\d+)"/g;
  let m;
  while ((m = rePost.exec(html))) posts.push({ post: m[1], at: m.index });
  for (let i = 0; i < posts.length; i++) {
    const start = posts[i].at;
    const end = i + 1 < posts.length ? posts[i + 1].at : html.length;
    const block = html.slice(start, end);
    if (block.includes('service_message')) continue;
    const textM = block.match(/js-message_text" dir="auto">([\s\S]*?)<\/div>/);
    const dateM = block.match(/datetime="([^"]+)"/);
    const photoM = block.match(/background-image:url\(\\?'(https:\/\/cdn4\.telesco\.pe\/[^'\\]+)/);
    const text = textM ? stripHtml(textM[1]) : '';
    if (!text && !photoM) continue;
    out.push({
      id: posts[i].post.split('/')[1],
      link: 'https://t.me/' + posts[i].post,
      date: dateM ? dateM[1] : '',
      text,
      photo: photoM ? photoM[1] : '',
    });
  }
  return out;
}

async function fetchDeals() {
  mkdirSync(ART_DIR, { recursive: true });
  const existing = readJson(DEALS_FILE, []);
  const clean = (d) => (d.user || '').length > 1 && d.id && d.id !== 'undefined';
  const tgMap = new Map(existing.filter((d) => !(d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const pageMap = new Map(existing.filter((d) => (d.user || '').startsWith('page:') && clean(d)).map((d) => [d.user + '/' + d.id, d]));
  const cutoff = Date.now() - DEAL_DAYS * 86400000;
  for (const ch of DEAL_CHANNELS) {
    try {
      const res = await fetch(`https://t.me/s/${ch.user}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const html = await res.text();
      const msgs = parseTelegramPage(html);
      let kept = 0;
      for (const msg of msgs) {
        if (!msg.date || new Date(msg.date).getTime() < cutoff) continue;
        const key = ch.user + '/' + msg.id;
        const prev = tgMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(msg.text.slice(0, 1500))) || msg.text;
          await sleep(150);
        }
        tgMap.set(key, {
          user: ch.user,
          store: ch.store,
          link: msg.link,
          date: msg.date,
          beijing: fmtBeijing(msg.date),
          text: msg.text,
          zh,
          photo: msg.photo,
          ...extractDealFields(msg.text, ''),
        });
        kept++;
      }
      console.log(`  deals ${ch.user}: ${msgs.length} 帖，保留 ${kept}`);
    } catch (e) {
      console.log(`  deals ${ch.user} fail: ${e.message}`);
    }
    await sleep(300);
  }
  for (const src of DEAL_PAGES) {
    try {
      const res = await fetch(src.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      });
      if (!res.ok) throw new Error('http ' + res.status);
      const items = src.parse(await res.text());
      const now = new Date().toISOString();
      let kept = 0;
      for (const it of items.slice(0, src.limit || 8)) {
        if (src.enrich) {
          await src.enrich(it);
          await sleep(200);
        }
        const key = 'page:' + src.id + '/' + it.id;
        const prev = pageMap.get(key);
        let zh = (prev && prev.zh) || '';
        if (!zh) {
          zh = (await translate(it.text.slice(0, 1500))) || it.text;
          await sleep(150);
        }
        pageMap.set(key, {
          user: 'page:' + src.id,
          id: it.id,
          store: src.store,
          link: it.link,
          date: now,
          beijing: fmtBeijing(now),
          text: it.text,
          zh,
          period: it.period || '',
          photo: '',
          ...extractDealFields(it.text, it.period || ''),
        });
        kept++;
      }
      console.log(`  deals ${src.id}: ${items.length} 条，保留 ${kept}`);
    } catch (e) {
      console.log(`  deals ${src.id} fail: ${e.message}`);
    }
    await sleep(300);
  }
  const pageItems = [...pageMap.values()];
  const tgItems = [...tgMap.values()]
    .filter((d) => d.date && new Date(d.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  const deals = [...pageItems, ...tgItems].slice(0, DEAL_MAX);
  writeFileSync(DEALS_FILE, JSON.stringify(deals, null, 2), 'utf8');
  return deals;
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
${PARENT_LINK}
<nav class="crumb"><a href="../index.html">← 返回首页</a></nav>
<header class="site-head article-head">
  <h1>${escapeHtml(rec.zh)}</h1>
  <div class="ru">${escapeHtml(rec.ru)}</div>
  <div class="meta">${catBadge(rec.cat)} <span class="mtime">● ${escapeHtml(rec.beijing)}（北京时间）</span> · <a href="${escapeHtml(rec.link)}" target="_blank" rel="noopener noreferrer">查看俄语原文 ↗</a></div>
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

function catBadge(cat) {
  const c = cat || 'news';
  return `<span class="badge badge-${c}">${CAT_LABEL[c] || '新闻'}</span>`;
}

function homepageHtml(records, deals, updated, widgets) {
  const recent = records.slice(0, HOMEPAGE_RECENT);
  const storeCounts = {};
  for (const d of deals) storeCounts[d.store] = (storeCounts[d.store] || 0) + 1;
  const storeChips = Object.keys(storeCounts)
    .sort((a, b) => storeCounts[b] - storeCounts[a])
    .map(
      (s) =>
        `<button class="chip" data-store="${escapeHtml(s)}" type="button">${escapeHtml(zhStore(s))}<b>${storeCounts[s]}</b></button>`
    )
    .join('\n');
  const dealBar = deals.length
    ? `<div class="deals-bar">
  <div class="storechips">
    <button class="chip active" data-store="" type="button">全部</button>
    ${storeChips}
  </div>
  <div class="deal-sort">
    <span class="deals-n">共 ${deals.length} 条</span>
    <button class="sbtn active" data-sort="time" type="button">最新</button>
    <button class="sbtn" data-sort="price" type="button">价格从低到高</button>
  </div>
</div>`
    : '';
  const dealCards = deals.length
    ? `<div class="deal-feed">
${dealBar}
${deals
  .map(
    (d) => `<article class="card deal" data-cat="deal" data-store="${escapeHtml(d.store)}" data-price="${d.price != null ? d.price : ''}" title="${escapeHtml((d.period ? d.period + ' · ' : '') + d.text.slice(0, 160))}">
  ${d.photo ? `<img class="deal-img" src="${escapeHtml(d.photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
  <div class="deal-head"><span class="store-badge">${escapeHtml(zhStore(d.store))}</span> <span class="store-ru">${escapeHtml(d.store)}</span> <span class="mtime">● ${escapeHtml(d.period || d.beijing + '（北京时间）')}</span></div>
  ${d.price != null
    ? `<div class="deal-price">${d.price.toFixed(2).replace('.', ',')}${d.priceUnit ? ' ' + escapeHtml(d.priceUnit) : ''}<span class="cur"> BYN</span>${d.oldPrice != null ? ` <s>${d.oldPrice.toFixed(2).replace('.', ',')}</s>` : ''}</div>`
    : d.discount != null
      ? `<div class="deal-price off">−${d.discount}%</div>`
      : ''}
  <p class="deal-text">${escapeHtml((d.zh || d.text).slice(0, 300))}</p>
  <span class="ru-src" hidden>${escapeHtml(d.text)}</span>
  <div class="meta"><a href="${escapeHtml(d.link)}" target="_blank" rel="noopener noreferrer">查看原文 ↗</a></div>
</article>`
  )
  .join('\n')}
</div>`
    : '';
  const cards = recent
    .map(
      (c) => `<article class="card" data-cat="${c.cat || 'news'}" title="${escapeHtml(c.ru.slice(0, 160))}">
  <h2 class="ttl"><a href="article/${encodeURIComponent(c.slug)}.html">${escapeHtml(c.zh)}</a></h2>
  <span class="ru-src" hidden>${escapeHtml(c.ru)}</span>
  ${(c.sum || '').length > 1 ? `<p class="sum">${escapeHtml(c.sum.slice(0, 160))} <a class="more" href="article/${encodeURIComponent(c.slug)}.html">阅读全文 ↗</a></p>` : ''}
  <div class="meta">${catBadge(c.cat)} <span class="mtime">● ${escapeHtml(c.beijing)}（北京时间）</span> <a href="${escapeHtml(c.link)}" target="_blank" rel="noopener noreferrer">原文 ↗</a></div>
</article>`
    )
    .join('\n');

  const older = records.slice(HOMEPAGE_RECENT);
  let olderHtml = '';
  if (older.length) {
    const list = older
      .map((o) => `<li class="arch-item" data-cat="${o.cat || 'news'}">${catBadge(o.cat)} <a href="article/${encodeURIComponent(o.slug)}.html">${escapeHtml(o.zh)}</a> <span class="old-date">${escapeHtml(o.beijing)}</span></li>`)
      .join('\n');
    olderHtml = `<details class="archive"><summary>更早的新闻（${records.length - recent.length} 篇）</summary>
<ul>${list}</ul></details>`;
  }

  const counts = { news: 0, event: 0, volunteer: 0, china: 0 };
  for (const r of records) counts[r.cat || 'news']++;
  const catInfo = `新闻 ${counts.news} · 活动 ${counts.event} · 志愿者 ${counts.volunteer} · 中白 ${counts.china} · 超市折扣 ${deals.length} 条`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>白俄新闻中文站 · 白俄罗斯新闻中文明日速览</title>
<meta name="description" content="自动翻译自 minsknews.by 的白俄罗斯与明斯克新闻，以及明斯克各大超市折扣（Telegram 汇总），定时更新，按北京时间显示。">
<meta property="og:type" content="website">
<meta property="og:site_name" content="白俄新闻中文站">
<meta property="og:title" content="白俄新闻中文站 · 白俄罗斯新闻中文明日速览">
<meta property="og:description" content="白俄罗斯与明斯克新闻（自动翻译自 minsknews.by）与明斯克超市折扣汇总（Telegram），定时更新。">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🌏</text></svg>">
<link rel="stylesheet" href="style.css">
</head>
<body>
${PARENT_LINK}
<header class="site-head">
  <h1>白俄新闻<span class="accent">中文站</span></h1>
  <p class="sub">白俄罗斯 &amp; 明斯克最新新闻 · 活动 · 志愿者 · 中白 · 超市折扣 · 自动翻译自 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">minsknews.by</a> · 新闻每 23 小时更新 · 折扣每 30 分钟更新</p>
  <p class="updated">更新于 ${updated}（北京时间）· 收录 ${records.length} 篇 · ${catInfo}</p>
</header>
${widgets}
<main>
<div class="searchbar">
  <input id="search" type="search" placeholder="🔍 搜索中文或俄语标题…" autocomplete="off" aria-label="站内搜索">
</div>
<div class="tabs" role="tablist">
  <button class="tab active" data-f="all">全部</button>
  <button class="tab" data-f="deal">超市折扣</button>
  <button class="tab" data-f="news">新闻</button>
  <button class="tab" data-f="event">活动</button>
  <button class="tab" data-f="volunteer">志愿者</button>
  <button class="tab" data-f="china">中白</button>
</div>
<p id="nores" class="nores" hidden>没有匹配的结果，换个关键词试试。</p>
${dealCards}
${cards}
${olderHtml}
</main>
<footer class="site-foot">
  <p>本站由机器自动抓取并翻译新闻，仅供学习交流，版权归原始来源 <a href="https://minsknews.by" target="_blank" rel="noopener noreferrer">«Минск-новости»</a> 所有。</p>
  <p>时间均为北京时间 · <a href="https://github.com/wjd888-aaa/minsk-news-cn" target="_blank" rel="noopener noreferrer">开源项目</a></p>
</footer>
<script>
(function () {
  var tabs = document.querySelectorAll('.tab');
  var items = document.querySelectorAll('.card, .arch-item');
  var arch = document.querySelector('.archive');
  var input = document.getElementById('search');
  var nores = document.getElementById('nores');
  var chips = document.querySelectorAll('.chip[data-store]');
  var sbtns = document.querySelectorAll('.sbtn');
  var activeStore = '';
  var sortMode = 'time';
  var feed = document.querySelector('.deal-feed');
  var origOrder = Array.prototype.slice.call(document.querySelectorAll('.card.deal'));
  function sortDeals() {
    if (!feed) return;
    var list;
    if (sortMode === 'price') {
      list = Array.prototype.slice.call(feed.querySelectorAll('.card.deal')).sort(function (a, b) {
        var pa = parseFloat(a.getAttribute('data-price') || '');
        var pb = parseFloat(b.getAttribute('data-price') || '');
        pa = isNaN(pa) ? 1e12 : pa;
        pb = isNaN(pb) ? 1e12 : pb;
        return pa - pb;
      });
    } else {
      list = origOrder.slice();
    }
    list.forEach(function (el) { feed.appendChild(el); });
  }
  function apply() {
    var active = document.querySelector('.tab.active');
    var f = active ? active.getAttribute('data-f') : 'all';
    var q = (input && input.value || '').toLowerCase().trim();
    var vis = 0;
    items.forEach(function (c) {
      var okCat = (f === 'all' || c.getAttribute('data-cat') === f);
      var okTxt = !q || (c.textContent || '').toLowerCase().indexOf(q) !== -1;
      var okStore = (c.getAttribute('data-cat') !== 'deal') || !activeStore || c.getAttribute('data-store') === activeStore;
      var show = okCat && okTxt && okStore;
      c.style.display = show ? '' : 'none';
      if (show) vis++;
    });
    if (nores) nores.hidden = vis !== 0;
    if (arch) arch.open = (q !== '' || f !== 'all');
    if (feed) {
      var dealVis = Array.prototype.some.call(feed.querySelectorAll('.card.deal'), function (c) {
        return c.style.display !== 'none';
      });
      feed.style.display = dealVis ? '' : 'none';
    }
    sortDeals();
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      tabs.forEach(function (x) { x.classList.remove('active'); });
      t.classList.add('active');
      apply();
    });
  });
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      activeStore = c.getAttribute('data-store');
      chips.forEach(function (x) { x.classList.toggle('active', x === c); });
      var dealTab = document.querySelector('.tab[data-f="deal"]');
      if (dealTab) {
        tabs.forEach(function (x) { x.classList.remove('active'); });
        dealTab.classList.add('active');
      }
      apply();
    });
  });
  sbtns.forEach(function (b) {
    b.addEventListener('click', function () {
      sortMode = b.getAttribute('data-sort');
      sbtns.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      apply();
    });
  });
  if (input) input.addEventListener('input', apply);
})();
</script>
</body>
</html>
`;
}

async function fetchNews() {
  console.log('Fetching RSS from ' + RSS_URL);
  const res = await fetch(RSS_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('RSS http ' + res.status);
  const xml = await res.text();
  const blocks = parseFeed(xml);
  console.log('Parsed items: ' + blocks.length);
  if (!blocks.length) throw new Error('no items parsed');

  // ---- 1. load existing index (re-classify by title so rules stay consistent) ----
  let index = readJson(INDEX_FILE, []);
  for (const r of index) r.cat = classify(r.ru || '');
  const byLink = new Map(index.map((r) => [r.link, r]));

  // ---- 2. collect new records ----
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
      cat: classify(ru),
      isodate,
      beijing: fmtBeijing(isodate),
    });
  }
  console.log('New articles: ' + newRecords.length);

  // ---- 3. translate new records (title + summary) ----
  for (const rec of newRecords) {
    const desc = stripHtml(field(blocks.find((b) => field(b, 'link').trim() === rec.link) || '', 'description'));
    process.stdout.write(`  title: ${rec.ru.slice(0, 40)} ... `);
    rec.zh = (await translate(rec.ru)) || rec.ru;
    rec.sum = desc ? (await translate(desc.slice(0, 700))) || '' : '';
    console.log('done');
    await sleep(200 + Math.random() * 200);
  }

  // ---- 4. full text for up to MAX_FULLTEXT (志愿者/活动优先, 再按最新) ----
  const fulltextOrder = [...newRecords].sort(
    (a, b) => (CAT_RANK[a.cat || 'news'] || 2) - (CAT_RANK[b.cat || 'news'] || 2)
  );
  let fulltextDone = 0;
  for (const rec of fulltextOrder) {
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

  // ---- 5. merge into index, sort desc ----
  for (const rec of newRecords) byLink.set(rec.link, rec);
  const records = [...byLink.values()].sort((a, b) => new Date(b.isodate) - new Date(a.isodate));

  // ---- 6. write article pages + persist ----
  mkdirSync(ART_DIR, { recursive: true });
  for (const rec of newRecords) {
    writeFileSync(path.join(ART_DIR, `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
  }
  writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2), 'utf8');
  writeFileSync(LAST_RUN_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }), 'utf8');

  return { records, newCount: newRecords.length, fulltextDone };
}

async function buildSite(records, deals) {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(path.join(OUT_DIR, 'article'), { recursive: true });
  const updated = nowBeijing();
  let widgets = '';
  try {
    const [w1, r1] = await Promise.all([fetchWeather(), fetchRates()]);
    const parts = [w1, r1].filter(Boolean).map((p) => `<p class="widget">${p}</p>`);
    if (parts.length) widgets = `<div class="widgets">${parts.join('')}</div>`;
  } catch (e) {
    console.log('widgets fetch fail: ' + e.message);
  }
  writeFileSync(path.join(OUT_DIR, 'index.html'), homepageHtml(records, deals, updated, widgets), 'utf8');
  for (const rec of records) {
    try {
      writeFileSync(path.join(OUT_DIR, 'article', `${rec.slug}.html`), articlePageHtml(rec), 'utf8');
    } catch {
      continue;
    }
  }
  copyFileSync(CSS_SRC, path.join(OUT_DIR, 'style.css'));
}

async function main() {
  // ---- 1. news 23h gate（只拦新闻，不拦超市折扣）----
  const lastRun = readJson(LAST_RUN_FILE, null);
  const gateBlocked = !!(lastRun && lastRun.ts && Date.now() - lastRun.ts < FETCH_INTERVAL_MS);

  let records = [];
  let newCount = 0;
  let fulltextDone = 0;
  if (gateBlocked) {
    const left = Math.ceil((FETCH_INTERVAL_MS - (Date.now() - lastRun.ts)) / 3600000);
    console.log(`SKIP news: 距上次抓取不足 23 小时，${left} 小时后再次检查。仍会抓取超市折扣并重建页面。`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'news_skipped=true\n');
    records = readJson(INDEX_FILE, []);
  } else {
    const r = await fetchNews();
    records = r.records;
    newCount = r.newCount;
    fulltextDone = r.fulltextDone;
  }

  // ---- 2. 超市折扣（始终抓取）----
  const deals = await fetchDeals();
  console.log('Deals: ' + deals.length + ' 条');

  // ---- 3. build site（始终重建）----
  await buildSite(records, deals);
  console.log(`DONE: 共 ${records.length} 篇，本次新增 ${newCount} 篇（全文 ${fulltextDone} 篇），折扣 ${deals.length} 条。`);
}

main().catch((e) => {
  console.error('BUILD ERROR:', e.message);
  process.exit(1);
});