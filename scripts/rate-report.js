'use strict';

// 汇率日报 -> WhatsApp（Kontato /v1/send）
// 由 GitHub Actions 每天 12:00 UTC（白俄 15:00）触发。
// 取数复用 build.js 同源接口：NBRB(央行) + UnionPay(银联)。
// 通过环境变量：
//   KONTATO_API_KEY  必填（仓库 Secret），发消息用
//   KONTATO_DESTS    收件人，逗号分隔，默认 375259741332,375292238345（两号同发同一条）
//   DRY_RUN=1        只打印不发送（本地调试）
//   LLM_URL          展望生成端点（默认 Pollinations，免密钥）
//   LLM_MODEL        模型名（默认 openai）

const API = 'https://api.kontato.ai/v1/send';
const DESTS = (process.env.KONTATO_DESTS || '375259741332,375292238345')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const KEY = process.env.KONTATO_API_KEY || '';
const DRY = process.env.DRY_RUN === '1';
const LLM_URL = process.env.LLM_URL || 'https://text.pollinations.ai/openai';
const LLM_MODEL = process.env.LLM_MODEL || 'openai';
const UA = { 'User-Agent': 'Mozilla/5.0' };

function ymd(d) {
  return (
    d.getUTCFullYear() +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    String(d.getUTCDate()).padStart(2, '0')
  );
}
function addDays(base, n) {
  return new Date(base.getTime() + n * 86400000);
}
function iso(d) {
  return (
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0')
  );
}
function pct(now, prev) {
  return ((now - prev) / prev) * 100;
}
function signed(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}

// 今日：央行每日牌价（CNY Cur_Scale=10 -> /10 得 CNYperBYN；USD Cur_Scale=1）
async function fetchToday() {
  const res = await fetch('https://api.nbrb.by/exrates/rates?periodicity=0', { headers: UA });
  if (!res.ok) throw new Error('nbrb today http ' + res.status);
  const list = await res.json();
  const cny = list.find((x) => x.Cur_Abbreviation === 'CNY' && x.Cur_Scale);
  const usd = list.find((x) => x.Cur_Abbreviation === 'USD' && x.Cur_Scale);
  const rub = list.find((x) => x.Cur_Abbreviation === 'RUB' && x.Cur_Scale);
  if (!cny || !usd) throw new Error('nbrb today missing CNY/USD');
  return {
    cnyperbyn: Number(cny.Cur_OfficialRate) / Number(cny.Cur_Scale),
    usd: Number(usd.Cur_OfficialRate) / Number(usd.Cur_Scale),
    rub: rub ? Number(rub.Cur_OfficialRate) / Number(rub.Cur_Scale) : null,
  };
}

// 指定日期某外币的央行牌价（返回 “1 单位外币 = ? BYN” 或 null）
async function fetchRateOn(curId, abbr, ondate) {
  try {
    const res = await fetch('https://api.nbrb.by/exrates/rates/' + curId + '?ondate=' + ondate, { headers: UA });
    if (!res.ok) return null;
    const j = await res.json();
    const arr = Array.isArray(j) ? j : [j];
    const cur = arr.find((x) => x.Cur_Abbreviation === abbr && x.Cur_Scale);
    if (!cur) return null;
    return Number(cur.Cur_OfficialRate) / Number(cur.Cur_Scale);
  } catch (e) {
    return null;
  }
}
const fetchCnyOn = (ondate) => fetchRateOn(462, 'CNY', ondate);
const fetchRubOn = (ondate) => fetchRateOn(456, 'RUB', ondate);

// 明日：从 +1 起依次试 +1/+2/+3（央行未来牌价可能尚未发布）
async function fetchTomorrow(today) {
  for (let i = 1; i <= 3; i++) {
    const v = await fetchCnyOn(iso(addDays(today, i)));
    if (v != null) return v;
  }
  return null;
}
// 昨日/前日：向前顺延
async function fetchBack(today, startBack) {
  for (let i = startBack; i <= startBack + 3; i++) {
    const v = await fetchCnyOn(iso(addDays(today, -i)));
    if (v != null) return v;
  }
  return null;
}

// 银联：今天/前一天/前两天（周末落到周五）依次取第一个 200
async function fetchUnionpay() {
  const beijing = new Date(Date.now() + 8 * 3600 * 1000);
  for (let back = 0; back <= 2; back++) {
    let dt = addDays(beijing, -back);
    const dow = dt.getUTCDay();
    if (dow === 6) dt = addDays(dt, -1);
    else if (dow === 0) dt = addDays(dt, -2);
    const url = 'https://www.unionpayintl.com/upload/jfimg/' + ymd(dt) + '.json';
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.unionpayintl.com/cn/rate/' },
      });
      if (!res.ok) continue;
      const j = await res.json();
      const rows = j.exchangeRateJson || [];
      const byn = rows.find((x) => x.transCur === 'BYN' && x.baseCur === 'CNY');
      const usd = rows.find((x) => x.transCur === 'USD' && x.baseCur === 'CNY');
      if (!byn) continue;
      return { bynInCny: Number(byn.rateData), usdInCny: usd ? Number(usd.rateData) : null };
    } catch (e) {
      /* try next */
    }
  }
  return null;
}

const OUTLOOK_FALLBACK =
  '📈 国际形势·15-30日展望：白卢布大体跟俄卢布走，俄卢布中期偏弱（制裁、炼油厂扰动、预算买汇）；人民币稳中偏强，结汇季有支撑。基准情景：CNY/BYN 缓升，换人民币成白卢布更划算。窗口提示：每月25-28日俄税期 CNY/BYN 易回落（别急着换），税期后、新制裁落地、美联储议息前后为关注窗口。以上为概率化判断，非精确日期承诺。';

// 展望：优先用免费 LLM 每天生成（免密钥），失败则回落到固定文案；两号共用同一条。
async function generateOutlook(ctx) {
  const sys =
    '你是白俄罗斯明斯克的中国留学生汇率助手。根据给定的官方汇率数据，写一段简洁的“📈 国际形势·15-30日展望”（3-5行，中文），' +
    '必须以“📈 国际形势·15-30日展望：”开头，适配 WhatsApp 阅读。要求：结合白卢布与俄卢布、人民币的联动逻辑给出概率化判断，' +
    '禁止给出“某天必涨/必跌”式的精确日期承诺；不得编造与给定数据矛盾的数字；不要使用 Markdown 标题或代码块。';
  const usr =
    '今天(明斯克)=' + ctx.date + '。数据：1 BYN = ' + ctx.cnyNow.toFixed(4) + ' CNY；1 BYN = ' + ctx.rubNow.toFixed(2) +
    ' RUB；1 USD = ' + ctx.usdCny.toFixed(4) + ' CNY。较昨日变化：CNY/BYN ' + signed(ctx.dCny) + '，RUB/BYN ' +
    signed(ctx.dRub) + '。请写出展望段落。';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: usr },
        ],
        max_tokens: 400,
        temperature: 0.7,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('llm http ' + res.status);
    const j = await res.json();
    let text = (((j.choices || [])[0] || {}).message || {}).content || '';
    text = String(text).trim();
    if (!text.startsWith('📈')) {
      const i = text.indexOf('📈 国际形势');
      text = i >= 0 ? text.slice(i) : '📈 国际形势·15-30日展望：' + text;
    }
    if (text.length < 30 || text.length > 800) throw new Error('llm bad length');
    return text;
  } catch (e) {
    return OUTLOOK_FALLBACK;
  }
}

async function buildMessage() {
  const today = new Date();
  const t = await fetchToday();
  const next = await fetchTomorrow(today);
  const yest = await fetchBack(today, 1);
  const prev2 = await fetchBack(today, 2);

  let rubYest = null;
  for (let i = 1; i <= 3 && rubYest == null; i++) rubYest = await fetchRubOn(iso(addDays(today, -i)));

  const blocks = [];

  blocks.push([
    '📊 汇率日报（白俄时间15:00）',
    '今日 1 Br = ¥' + (1 / t.cnyperbyn).toFixed(4) + ' ｜ 1 $ = ¥' + (t.usd / t.cnyperbyn).toFixed(4),
    '🔮 明日 1 Br = ¥' + (next != null ? (1 / next).toFixed(4) : '—'),
  ]);

  const segs = [];
  if (yest != null && prev2 != null) segs.push({ k: '昨较前', v: pct(yest, prev2) });
  segs.push({ k: '今较昨', v: pct(t.cnyperbyn, yest != null ? yest : t.cnyperbyn) });
  if (next != null) segs.push({ k: '明较今', v: pct(next, t.cnyperbyn) });

  const trend = ['涨跌（1 CNY兑BYN）：'];
  for (const s of segs) trend.push(s.k + '：' + signed(s.v));
  const hot = segs.filter((s) => Math.abs(s.v) >= 0.1);
  if (hot.length) {
    const desc = hot
      .map((s) => s.k + (s.v >= 0 ? '走高' : '走低') + '（' + (s.v >= 0 ? '换白卢布更划算' : '先等等') + '）')
      .join('；');
    trend.push('✅【提醒】' + desc + '。');
  } else {
    trend.push('ℹ️【提示】涨跌均未超 0.1%，汇率平稳，可正常安排。');
  }
  blocks.push(trend);

  const cnyChg = yest != null ? pct(t.cnyperbyn, yest) : 0;
  const rubChg = t.rub != null && rubYest != null ? pct(t.rub, rubYest) : 0;
  const outlook = await generateOutlook({
    date: iso(today),
    cnyNow: 1 / t.cnyperbyn,
    rubNow: t.rub != null ? 1 / t.rub : 0,
    usdCny: t.usd / t.cnyperbyn,
    dCny: cnyChg,
    dRub: rubChg,
  });
  blocks.push([outlook, '建议：分批换、别赌单一时点。']);

  let upLine;
  try {
    const up = await fetchUnionpay();
    if (up && up.bynInCny != null) {
      upLine = '🇨🇳 中国银联汇率 1 Br ≈ ' + up.bynInCny.toFixed(4) + ' ¥';
      if (up.usdInCny != null) upLine += ' ｜ 1 $ ≈ ' + up.usdInCny.toFixed(4) + ' ¥';
    } else {
      throw new Error('unionpay unavailable');
    }
  } catch (e) {
    upLine =
      '🇨🇳 中国银联汇率 1 Br ≈ ' +
      (1 / t.cnyperbyn).toFixed(4) +
      ' ¥ ｜ 1 $ ≈ ' +
      (t.usd / t.cnyperbyn).toFixed(4) +
      ' ¥（NBRB换算）';
  }
  blocks.push([upLine]);

  return blocks.map((b) => b.join('\n')).join('\n\n');
}

async function sendTo(dest, message) {
  if (DRY) {
    console.log('--- DRY RUN (未发送) to ' + dest + ' ---');
    console.log(message);
    return;
  }
  if (!KEY) throw new Error('KONTATO_API_KEY 未设置');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, to: dest }),
  });
  const txt = await res.text();
  console.log('send => ' + res.status + ' to ' + dest + ' ' + txt);
  if (!res.ok) throw new Error('kontato send http ' + res.status + ' to ' + dest + ': ' + txt);
}

(async () => {
  const message = await buildMessage();
  for (const dest of DESTS) {
    try {
      await sendTo(dest, message);
    } catch (e) {
      console.error('send to ' + dest + ' failed: ' + e.message);
    }
  }
})().catch((e) => {
  console.error('rate-report fail: ' + e.message);
  process.exit(1);
});
