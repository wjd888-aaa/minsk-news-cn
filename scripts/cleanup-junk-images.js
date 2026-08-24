const { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync } = require('fs');
const path = require('path');
const crypto = require('crypto');

const ART = path.join(__dirname, '..', 'articles');
const IMGS = path.join(ART, 'imgs');

function md5(p) {
  return crypto.createHash('md5').update(readFileSync(p)).digest('hex');
}

// 1. 统计所有图片内容的出现文章数
const byHash = new Map();
for (const slug of readdirSync(IMGS)) {
  const dir = path.join(IMGS, slug);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!statSync(p).isFile()) continue;
    const h = md5(p);
    if (!byHash.has(h)) byHash.set(h, { count: 0, sample: p });
    byHash.get(h).count++;
  }
}

// 2. 出现在 10 篇以上文章的 = 全站模板图，删除
const junk = new Set();
for (const [h, info] of byHash) {
  if (info.count >= 10) {
    junk.add(h);
    try { unlinkSync(info.sample); console.log('删除模板图: ' + path.basename(info.sample) + ' (出现' + info.count + '篇)'); } catch (e) {}
  }
}
// 同哈希的其余副本也删
for (const slug of readdirSync(IMGS)) {
  const dir = path.join(IMGS, slug);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!statSync(p).isFile()) continue;
    if (junk.has(md5(p))) { try { unlinkSync(p); } catch (e) {} }
  }
}

// 3. 同步 index.json：移除指向已删文件的条目；顺带清理空图片目录
const idxPath = path.join(ART, 'index.json');
const idx = JSON.parse(readFileSync(idxPath, 'utf8'));
let cleaned = 0;
for (const r of idx) {
  if (!r.images || !r.images.length) continue;
  const kept = r.images.filter((rel) => {
    const p = path.join(ART, rel.replace(/^\.\.\//, '').replace(/\//g, path.sep));
    return existsSync(p);
  });
  if (kept.length !== r.images.length) {
    cleaned += r.images.length - kept.length;
    r.images = kept;
  }
}
writeFileSync(idxPath, JSON.stringify(idx, null, 2), 'utf8');
console.log(`清理完成: 删除模板图 ${junk.size} 种, 移除失效引用 ${cleaned} 条`);

// 4. 复检
const map2 = new Map();
let total = 0;
for (const slug of readdirSync(IMGS)) {
  const dir = path.join(IMGS, slug);
  if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (!statSync(p).isFile()) continue;
    total++;
    const h = md5(p).slice(0, 10);
    map2.set(h, (map2.get(h) || 0) + 1);
  }
}
const remain = [...map2.values()].filter((n) => n > 1).length;
console.log(`复检: 文件 ${total}, 独立内容 ${map2.size}, 跨文章重复组 ${remain}`);
