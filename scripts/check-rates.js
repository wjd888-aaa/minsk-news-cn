'use strict';

/**
 * 线上汇率自检：确认页面顶部展示的数字与它自己标注的来源一致。
 *
 * 这是对最初故障的兜底：银联 404 时旧代码静默改用央行/市场价，却仍写「银联」。
 * 现在只要「标注 ≠ 数值来源」或数值越界，本脚本就以退出码 1 报警。
 *
 * 用法：
 *   node scripts/check-rates.js
 *   node scripts/check-rates.js --url https://news.minsktc.me/
 */

const { fetchUnionpay, fetchNbrb, fetchErApi, BOUNDS } = require('./rates');

const DEFAULT_URL = 'https://news.minsktc.me/';
const TOLERANCE = 0.0015; // 页面保留 3 位小数，留一点四舍五入余量
const MAX_AGE_DAYS = 3;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const LINE_RE = /🇧🇾\s*([^｜<\n]+?)｜1 Br ≈ ([\d.]+) ¥｜1 \$ ≈ ([\d.]+) ¥/;

function parsePage(html) {
  const m = String(html).match(LINE_RE);
  if (!m) return null;
  const head = m[1].trim();
  const labelMatch = head.match(/银联|白央行|市场参考|缓存/);
  return {
    raw: m[0],
    head,
    label: labelMatch ? labelMatch[0] : null,
    date: (head.match(/\d{2}-\d{2}/) || [null])[0],
    cached: /缓存/.test(head),
    bynInCny: Number(m[2]),
    usdInCny: Number(m[3]),
  };
}

function pct(a, b) {
  return Math.abs(a - b) / b * 100;
}

async function main() {
  const url = arg('--url', DEFAULT_URL);
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'v=' + Date.now(), {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; minsk-news-cn rate check)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error('页面请求失败 http ' + res.status + ' ' + url);
  const page = parsePage(await res.text());
  if (!page) {
    throw new Error('页面里找不到汇率行，可能尚未部署新版（应形如「🇧🇾 银联 11-02｜1 Br ≈ 2.265 ¥｜1 $ ≈ 6.672 ¥」）');
  }

  const problems = [];
  const checkBounds = (name, v, [lo, hi]) => {
    if (!Number.isFinite(v) || v < lo || v > hi) problems.push(`${name} 数值异常：${v}（合理区间 ${lo}~${hi}）`);
  };
  checkBounds('页面 BYN→CNY', page.bynInCny, BOUNDS.bynInCny);
  checkBounds('页面 USD→CNY', page.usdInCny, BOUNDS.usdInCny);

  const sources = {};
  for (const [name, fn] of [
    ['unionpay', fetchUnionpay],
    ['nbrb', fetchNbrb],
    ['erapi', fetchErApi],
  ]) {
    try {
      sources[name] = await fn();
    } catch (e) {
      console.log(`[warn] ${name} 不可用：${e.message}`);
    }
  }

  const labelToSource = { 银联: 'unionpay', 白央行: 'nbrb', 市场参考: 'erapi' };
  const expectKey = labelToSource[page.label];
  const expect = expectKey ? sources[expectKey] : null;

  console.log('页面：' + page.raw);
  for (const [k, v] of Object.entries(sources)) {
    console.log(
      `${k.padEnd(9)} ${v.date}  ${v.bynInCny.toFixed(4)} / ${v.usdInCny.toFixed(4)}` +
        (expect && k === expectKey ? '  <= 页面标注' : '')
    );
  }

  if (page.cached) {
    console.log('[warn] 页面使用的是缓存汇率，跳过严格比对（已检查数值区间）');
  } else if (!expectKey) {
    problems.push('页面汇率没有可识别的来源标注：' + page.head);
  } else if (!expect) {
    problems.push(`页面标注「${page.label}」，但该来源当前不可用，无法核验`);
  } else {
    const db = pct(page.bynInCny, expect.bynInCny);
    const du = pct(page.usdInCny, expect.usdInCny);
    const dev = Math.max(db, du);
    if (page.date !== expect.date.slice(5)) {
      problems.push(`页面日期 ${page.date} 与${page.label}数据日期 ${expect.date.slice(5)} 不一致`);
    }
    if (dev > TOLERANCE * 100) {
      const other = Object.entries(sources)
        .filter(([k]) => k !== expectKey)
        .map(([k, v]) => `${k}=${v.bynInCny.toFixed(4)}`)
        .join('，');
      problems.push(
        `页面标注「${page.label}」(${page.bynInCny})，但${page.label}实际为 ${expect.bynInCny.toFixed(4)}，` +
          `偏差 ${dev.toFixed(2)}%${other ? '；其他来源：' + other : ''}`
      );
    }
    const age = (Date.now() - Date.parse(expect.date + 'T00:00:00Z')) / 86400000;
    if (Number.isFinite(age) && age > MAX_AGE_DAYS) {
      problems.push(`来源数据日期 ${expect.date} 已超过 ${MAX_AGE_DAYS} 天`);
    }
  }

  if (problems.length) {
    for (const p of problems) console.error('[FAIL] ' + p);
    process.exit(1);
  }
  console.log('[OK] 页面数值与标注来源一致');
}

module.exports = { parsePage, LINE_RE };

if (require.main === module) {
  main().catch((e) => {
    console.error('[FAIL] ' + e.message);
    process.exit(1);
  });
}
