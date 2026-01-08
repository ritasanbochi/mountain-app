// mountaimSets.js (Quota-safe)
// - 花100: Wikipedia本文HTMLの "先頭wikitable" から「山名列」だけ抽出（リンク全拾いしない）
// - 二百/三百: Templateページの parse.links から抽出（余計なリンクを除外）
// - localStorage保存がQuota超過したら「保存せず続行」する（機能は止めない）

export const GEO_OVERRIDES = {
  // 最小限だけ手動追加する用（必要になったら追記）
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

// index.html が import する
export const SET_DEFS = {
  HYAKU:      { label: "百名山",       wikiPage: null, mode: null },
  HANA_100:   { label: "花の百名山",   wikiPage: "花の百名山", mode: "wikitable_text" },
  NIHON_200:  { label: "二百名山",     wikiPage: "Template:日本二百名山", mode: "template_links" },
  NIHON_300:  { label: "三百名山",     wikiPage: "Template:日本三百名山", mode: "template_links" },
};

export const SET_LABELS = Object.fromEntries(Object.entries(SET_DEFS).map(([k,v]) => [k, v.label]));

const WIKI_API = "https://ja.wikipedia.org/w/api.php";

// キャッシュ（小さく・安全に）
const CACHE_PREFIX = "mount_set_names_v6"; // ★ v5 → v6 に上げて既存巨大キャッシュを無視
const CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60日

function cacheKey(setKey){ return `${CACHE_PREFIX}:${setKey}`; }
function safeJsonParse(s){ try{ return JSON.parse(s); }catch{ return null; } }
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }

function normalizeName(s){
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\[.*?\]/g, "")     // 注釈っぽいもの
    .replace(/[（(].*?[）)]/g, ""); // 括弧注記
}

// “山っぽくない”ノイズを落とす（最低限）
function isClearlyNotMountain(name){
  if (!name) return true;
  // 山/岳/峰が無い & 典型的スポット語尾は除外
  const hasMountainWord = /山|岳|峰/u.test(name);
  if (!hasMountainWord && /(沼|湿原|高原|ヶ原|原|峠|岬|浜|滝|湖)$/u.test(name)) return true;

  // 明らかに組織・施設系
  if (/(新聞|新聞社|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村|空港|港|ダム)$/u.test(name)) return true;

  return false;
}

function trySaveCache(setKey, names, meta){
  const key = cacheKey(setKey);
  const payload = {
    fetchedAt: new Date().toISOString(),
    fetchedAtMs: Date.now(),
    names,
    meta,
  };
  try{
    localStorage.setItem(key, JSON.stringify(payload));
    return true;
  }catch(e){
    // QuotaExceededError など：保存を諦めて続行
    console.warn("[mountaimSets] cache save skipped:", e?.name || e, setKey, names?.length);
    return false;
  }
}

function loadCache(setKey){
  const key = cacheKey(setKey);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj?.fetchedAtMs || !Array.isArray(obj?.names)) return null;
  if (Date.now() - obj.fetchedAtMs > CACHE_TTL_MS) return null;
  return obj;
}

// ---- Wikipedia API helpers ----
async function wikiParse(page, prop){
  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    origin: "*",
    page,
    prop,
  });
  const url = `${WIKI_API}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const json = await res.json();
  return { url, json };
}

// 花100：先頭wikitableから「山名列」だけ抽出
function extractHana100FromHtml(htmlText){
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const table = doc.querySelector("table.wikitable");
  if (!table) return [];

  const names = [];
  const rows = [...table.querySelectorAll("tr")];

  for (const tr of rows){
    const tds = [...tr.querySelectorAll("td")];
    if (!tds.length) continue;

    // 花100の表は多くの場合 2列目が山名（番号/山名/よみ/標高…）
    const candidates = [tds[1], tds[0], tds[2]].filter(Boolean);

    let got = null;
    for (const td of candidates){
      const a = td.querySelector("a");
      if (a?.textContent){
        got = a.textContent.trim();
        break;
      }
      const txt = td.textContent?.trim();
      if (txt){
        got = txt;
        break;
      }
    }
    got = normalizeName(got);
    if (!got) continue;
    if (isClearlyNotMountain(got)) continue;

    // 山/岳/峰を含むものを優先（ただし花100は表記ゆれがあるので厳しすぎない）
    if (!/山|岳|峰/u.test(got)) continue;

    names.push(got);
  }

  return uniq(names);
}

// 二百/三百：Template parse.links から抽出（タイトルだけ）
function extractFromTemplateLinks(parse){
  const links = parse?.links;
  if (!Array.isArray(links)) return [];
  const names = links
    .map(l => normalizeName(l?.title))
    .filter(Boolean)
    .filter(n => /山|岳|峰/u.test(n)) // 山っぽいものだけ
    .filter(n => !isClearlyNotMountain(n));
  return uniq(names);
}

/**
 * 山セットの山名リストを取得
 * - キャッシュがあればそれを返す
 * - 取れた結果は「保存できれば保存」する（Quota超過なら保存スキップ）
 */
export async function loadSetNames(setKey){
  const def = SET_DEFS[setKey];
  if (!def) throw new Error(`Unknown setKey: ${setKey}`);
  if (!def.wikiPage) return { names: [], meta: { cached: false, fetchedAt: null, count: 0 } };

  const cached = loadCache(setKey);
  if (cached){
    return { names: cached.names, meta: { cached: true, fetchedAt: cached.fetchedAt, count: cached.names.length } };
  }

  if (def.mode === "wikitable_text"){
    const { url, json } = await wikiParse(def.wikiPage, "text");
    const html = json?.parse?.text?.["*"] || "";
    const names = extractHana100FromHtml(html);

    // 保存（できたら）
    trySaveCache(setKey, names, { url, page: def.wikiPage, mode: def.mode });
    return { names, meta: { cached: false, fetchedAt: new Date().toISOString(), count: names.length } };
  }

  if (def.mode === "template_links"){
    const { url, json } = await wikiParse(def.wikiPage, "links");
    const names = extractFromTemplateLinks(json?.parse);

    trySaveCache(setKey, names, { url, page: def.wikiPage, mode: def.mode });
    return { names, meta: { cached: false, fetchedAt: new Date().toISOString(), count: names.length } };
  }

  throw new Error(`Unknown mode: ${def.mode}`);
}

// デバッグ用
export function clearSetCache(setKey){
  localStorage.removeItem(cacheKey(setKey));
}
