// mountaimSets.js
// ✅ 花の百名山 / 日本二百名山 / 日本三百名山 を “Wikipediaから自動取得” して山名リスト化する
//  - ここでは「どこから取るか」と「どう抽出するか」を定義
//  - 実データ（山名一覧）は runtime で取得して localStorage キャッシュ

const WIKI_API = "https://ja.wikipedia.org/w/api.php";
const CACHE_PREFIX = "mount_set_v1_";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日

function nowIso(){ return new Date().toISOString(); }
function safeJsonParse(s){ try { return JSON.parse(s); } catch { return null; } }

function cacheKey(setKey){ return `${CACHE_PREFIX}${setKey}`; }
function loadCache(setKey){
  const raw = localStorage.getItem(cacheKey(setKey));
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj?.fetchedAt || !Array.isArray(obj?.names)) return null;
  const ts = Date.parse(obj.fetchedAt);
  if (!Number.isFinite(ts)) return null;
  if (Date.now() - ts > CACHE_TTL_MS) return null;
  return obj;
}
function saveCache(setKey, names, meta){
  localStorage.setItem(cacheKey(setKey), JSON.stringify({ fetchedAt: nowIso(), names, meta }));
}

function uniq(arr){
  return [...new Set(arr.filter(Boolean).map(s => String(s).trim()).filter(Boolean))];
}

async function wikiParse(page, prop){
  const params = new URLSearchParams({
    action: "parse",
    page,
    prop,
    format: "json",
    origin: "*"
  });
  const url = `${WIKI_API}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia API HTTP ${res.status}`);
  const json = await res.json();
  return { json, url };
}

// --- 抽出 1：Templateページの links から山名候補を拾う ---
function extractFromParseLinks(parse){
  // parse.links: [{ns,title,exists?}, ...]
  const links = parse?.links;
  if (!Array.isArray(links)) return [];
  return links
    .map(l => l?.title)
    .filter(Boolean)
    // “山”っぽいリンクだけ残す（テンプレ内の余計なリンク除去）
    .filter(t => !String(t).includes("Template:"))
    .filter(t => !String(t).includes("Help:"))
    .filter(t => !String(t).includes("Wikipedia:"))
    .filter(t => !String(t).includes("Portal:"))
    .filter(t => !String(t).includes("Category:"));
}

// --- 抽出 2：記事本文HTML（wikitable）から山名列を拾う ---
function extractFromWikitableHtml(htmlText){
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const tables = [...doc.querySelectorAll("table.wikitable")];
  if (!tables.length) return [];
  // 先頭のwikitableを優先（花の百名山ページの“一覧”が大体これ）
  const table = tables[0];
  const rows = [...table.querySelectorAll("tr")];

  const names = [];
  for (const tr of rows){
    const cells = [...tr.querySelectorAll("td")];
    if (!cells.length) continue;

    // Wikipediaの一覧はだいたい「番号 / 山名 / よみ / 標高 / ...」形式
    // 山名セルは 2列目になりがちなのでまずそこを見る
    const candidateCells = [cells[1], cells[0], cells[2]].filter(Boolean);

    let got = null;
    for (const c of candidateCells){
      // リンクテキスト（<a>）を優先
      const a = c.querySelector("a");
      if (a?.textContent){
        got = a.textContent.trim();
        break;
      }
      const txt = c.textContent?.trim();
      if (txt){
        got = txt;
        break;
      }
    }
    if (!got) continue;

    // 余計な注記除去
    got = got.replace(/\[.*?\]/g, "").trim();
    if (got) names.push(got);
  }
  return names;
}

export const SET_DEFS = {
  HANA_100: {
    label: "花100",
    tag: "花100",
    source: { type:"page_html_wikitable", page:"花の百名山" }
  },
  NIHON_200: {
    label: "二百名山",
    tag: "二百名山",
    source: { type:"template_links", page:"Template:日本二百名山" }
  },
  NIHON_300: {
    label: "三百名山",
    tag: "三百名山",
    source: { type:"template_links", page:"Template:日本三百名山" }
  }
};

// 同名が多いなど、座標確定が必要になった山だけ追記していく（最初は空でOK）
export const GEO_OVERRIDES = {
  // "大山": { lat: 35.371, lng: 133.546, elev: 1729 },
};

export async function loadSetNames(setKey){
  const def = SET_DEFS[setKey];
  if (!def) throw new Error(`Unknown setKey: ${setKey}`);

  const cached = loadCache(setKey);
  if (cached) return { names: cached.names, meta: { cached:true, ...cached.meta } };

  const src = def.source;

  if (src.type === "template_links"){
    const { json, url } = await wikiParse(src.page, "links");
    const names = uniq(extractFromParseLinks(json?.parse));
    saveCache(setKey, names, { url, page: src.page, mode: src.type });
    return { names, meta: { cached:false, url, page: src.page, mode: src.type } };
  }

  if (src.type === "page_html_wikitable"){
    const { json, url } = await wikiParse(src.page, "text");
    const html = json?.parse?.text?.["*"] || "";
    const names = uniq(extractFromWikitableHtml(html));
    saveCache(setKey, names, { url, page: src.page, mode: src.type });
    return { names, meta: { cached:false, url, page: src.page, mode: src.type } };
  }

  throw new Error(`Unknown source type: ${src.type}`);
}
