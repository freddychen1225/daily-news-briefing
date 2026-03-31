import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const outDir = path.resolve('data');
const outFile = path.join(outDir, 'news.json');

const FEEDS = [
  {
    name: 'Google News 全球社會 zh-TW',
    url: 'https://news.google.com/rss/search?q=%E7%A4%BE%E6%9C%83+OR+crime+OR+court+OR+police+when:1d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
  },
  {
    name: 'Google News 全球罕見 zh-TW',
    url: 'https://news.google.com/rss/search?q=%E7%BD%95%E8%A6%8B+OR+%E9%9B%A2%E5%A5%87+OR+weird+OR+bizarre+when:3d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
  },
  {
    name: 'Google News 全球驚奇 zh-TW',
    url: 'https://news.google.com/rss/search?q=%E9%A9%9A%E8%A6%8B+OR+%E4%B8%8D%E5%8F%AF%E6%80%9D%E8%AD%B0+OR+surprising+OR+unusual+when:3d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant'
  }
];

const SOCIAL_KEYWORDS = ['社會', '警方', '警', '法院', '法官', '地檢', '檢方', '起訴', '命案', '車禍', '事故', '詐騙', '糾紛', 'crime', 'court', 'police'];
const WOW_KEYWORDS = ['罕見', '離奇', '驚見', '首見', '首次', '不可思議', '意外', '巧合', '反轉', '奇聞', 'weird', 'bizarre', 'surprising', 'unusual'];
const NEGATIVE_KEYWORDS = ['娛樂', '股票', '體育', 'NBA', 'MLB', '演唱會', '影評'];

function arrify(v) { return !v ? [] : Array.isArray(v) ? v : [v]; }
function normalizeLink(link) { return !link ? '' : typeof link === 'string' ? link : link.href || ''; }
function fullText(item) { return [item.title, item.description, item.content].filter(Boolean).join(' '); }

function scoreItem(item) {
  const text = fullText(item);
  const social = SOCIAL_KEYWORDS.filter(k => text.includes(k)).length;
  const wow = WOW_KEYWORDS.filter(k => text.includes(k)).length;
  const negative = NEGATIVE_KEYWORDS.some(k => text.includes(k));
  let score = social * 3 + wow * 4;
  if (negative) score -= 6;
  return { score, social, wow, negative };
}

function summarize(title, source) {
  return `${title}。這則新聞由 ${source || '新聞來源'} 報導，系統將它列入剪報，是因為它兼具社會事件脈絡或罕見反差，適合快速閱讀後延伸討論。`;
}

function buildAngle(title, interesting) {
  if (interesting) return `你會怎麼跟朋友聊這則新聞：${title}，到底是真實世界太離奇，還是原本就存在大家沒注意到的制度或人性問題？`;
  return `如果這類事件發生在你所在城市，你會先要求更嚴格管理，還是認為社會成本不該全由一般人承擔？`;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, { headers: { 'user-agent': 'Mozilla/5.0 DailyBriefingBot/1.0' } });
  if (!res.ok) throw new Error(`${feed.name} failed: ${res.status}`);
  const xml = await res.text();
  const data = parser.parse(xml);
  const items = arrify(data?.rss?.channel?.item);
  return items.map(item => ({
    feed: feed.name,
    title: item.title || '',
    link: normalizeLink(item.link),
    pubDate: item.pubDate || '',
    source: typeof item.source === 'string' ? item.source : item.source?.['#text'] || feed.name,
    description: item.description || ''
  }));
}

const fetched = await Promise.allSettled(FEEDS.map(fetchFeed));
const combined = fetched.flatMap(r => r.status === 'fulfilled' ? r.value : []);
const seen = new Set();
const deduped = [];
for (const item of combined) {
  const key = `${item.title}|${item.link}`;
  if (!item.title || !item.link || seen.has(key)) continue;
  seen.add(key);
  deduped.push(item);
}

const ranked = deduped.map(item => {
  const scored = scoreItem(item);
  const interesting = scored.wow > 0 || /罕見|離奇|驚見|首見|不可思議|反轉|巧合|weird|bizarre|surprising|unusual/i.test(item.title);
  const category = interesting ? '開眼界精選' : '社會地方';
  return {
    title: item.title,
    url: item.link,
    source: item.source,
    pubDate: item.pubDate,
    category,
    interesting,
    score: scored.score,
    summary: summarize(item.title, item.source),
    angle: buildAngle(item.title, interesting)
  };
}).filter(item => item.score >= 3).sort((a, b) => b.score - a.score).slice(0, 12);

const output = {
  generatedAt: new Date().toISOString(),
  locale: 'zh-TW',
  note: '內容可不限國內外，但頁面以繁體中文來源與繁體中文 RSS 搜尋參數為主。',
  count: ranked.length,
  items: ranked
};

await fs.mkdir(outDir, { recursive: true });
await fs.writeFile(outFile, JSON.stringify(output, null, 2), 'utf8');
console.log(`Wrote ${ranked.length} items to ${outFile}`);