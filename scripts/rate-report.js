'use strict';

// 汇率日报 -> WhatsApp（Kontato /v1/send）
// 由 GitHub Actions 每天 12:00 UTC（白俄 15:00）触发。
// 取数复用 build.js 同源接口：NBRB(央行) + UnionPay(银联)。
// 通过环境变量：
//   KONTATO_API_KEY  必填（仓库 Secret），发消息用
//   KONTATO_DEST     收件人，默认 375292238345
//   DRY_RUN=1        只打印不发送（本地调试）

const API = 'https://api.kontato.ai/v1/send';
const DEST = process.env.KONTATO_DEST || '375292238345';
const KEY = process.env.KONTATO_API_KEY || '';
const DRY = process.env.DRY_RUN === '1';
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
  if (!cny || !usd) throw new Error('nbrb today missing CNY/USD');
  return {
    cnyperbyn: Number(cny.Cur_OfficialRate) / Number(cny.Cur_Scale),
    usd: Number(usd.Cur_OfficialRate) / Number(usd.Cur_Scale),
  };
}

// 指定日期 CNY->BYN（465 为 CNY 的 Cur_ID；返回 CNYperBYN 或 null）
async function fetchCnyOn(ondate) {
  try {
    const res = await fetch('https://api.nbrb.by/exrates/rates/462?ondate=' + ondate, { headers: UA });
    if (!res.ok) return null;
    const j = await res.json();
    const arr = Array.isArray(j) ? j : [j];
    const cny = arr.find((x) => x.Cur_Abbreviation === 'CNY' && x.Cur_Scale);
    if (!cny) return null;
    return Number(cny.Cur_OfficialRate) / Number(cny.Cur_Scale);
  } catch (e) {
    return null;
  }
}

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

const OUTLOOK =
  '📈 国际形势·15-30日展望：白卢布大体跟俄卢布走，俄卢布中期偏弱（制裁、炼油厂扰动、预算买汇）；人民币稳中偏强，结汇季有支撑。基准情景：CNY/BYN 缓升，换人民币成白卢布更划算。窗口提示：每月25-28日俄税期 CNY/BYN 易回落（别急着换），税期后、新制裁落地、美联储议息前后为关注窗口。以上为概率化判断，非精确日期承诺。';

async function buildMessage() {
  const today = new Date();
  const t = await fetchToday();
  const next = await fetchTomorrow(today);
  const yest = await fetchBack(today, 1);
  const prev2 = await fetchBack(today, 2);

  const lines = [];
  lines.push('📊 汇率日报（白俄时间15:00）');
  lines.push('今日 1 Br = ¥' + (1 / t.cnyperbyn).toFixed(4) + ' ｜ 1 $ = ¥' + (t.usd / t.cnyperbyn).toFixed(4));
  lines.push('🔮 明日 1 Br = ¥' + (next != null ? (1 / next).toFixed(4) : '—'));

  lines.push('涨跌（1 CNY兑BYN）：');
  const segs = [];
  if (yest != null && prev2 != null) segs.push({ k: '昨较前', v: pct(yest, prev2) });
  segs.push({ k: '今较昨', v: pct(t.cnyperbyn, yest != null ? yest : t.cnyperbyn) });
  if (next != null) segs.push({ k: '明较今', v: pct(next, t.cnyperbyn) });
  for (const s of segs) lines.push(s.k + '：' + signed(s.v));

  const hot = segs.filter((s) => Math.abs(s.v) >= 0.1);
  if (hot.length) {
    const desc = hot
      .map((s) => s.k + (s.v >= 0 ? '走高' : '走低') + '（' + (s.v >= 0 ? '换白卢布更划算' : '先等等') + '）')
      .join('；');
    lines.push('✅【提醒】' + desc + '。');
  } else {
    lines.push('ℹ️【提示】涨跌均未超 0.1%，汇率平稳，可正常安排。');
  }

  lines.push(OUTLOOK);
  lines.push('建议：分批换、别赌单一时点。');

  let upLine;
  try {
    const up = await fetchUnionpay();
    if (up && up.bynInCny != null) {
      upLine = '🇨🇳 中国银联汇率 1 Br ≈ ' + up.bynInCny.toFixed(3) + ' ¥';
      if (up.usdInCny != null) upLine += ' ｜ 1 $ ≈ ' + up.usdInCny.toFixed(3) + ' ¥';
    } else {
      throw new Error('unionpay unavailable');
    }
  } catch (e) {
    upLine =
      '🇨🇳 中国银联汇率 1 Br ≈ ' +
      (1 / t.cnyperbyn).toFixed(3) +
      ' ¥ ｜ 1 $ ≈ ' +
      (t.usd / t.cnyperbyn).toFixed(3) +
      ' ¥（NBRB换算）';
  }
  lines.push(upLine);

  return lines.join('\n');
}

async function send(message) {
  if (DRY) {
    console.log('--- DRY RUN (未发送) ---');
    console.log(message);
    return;
  }
  if (!KEY) throw new Error('KONTATO_API_KEY 未设置');
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, to: DEST }),
  });
  const txt = await res.text();
  console.log('send => ' + res.status + ' ' + txt);
  if (!res.ok) throw new Error('kontato send http ' + res.status + ': ' + txt);
}

(async () => {
  const message = await buildMessage();
  await send(message);
})().catch((e) => {
  console.error('rate-report fail: ' + e.message);
  process.exit(1);
});
