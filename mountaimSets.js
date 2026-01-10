// mountaimSets.js (v11)
// - localStorageへ保存しない（QuotaExceededErrorを根絶）
// - 0件になった原因が見えるように debug 情報を返す

export const GEO_OVERRIDES = {
  // ここは必要最小限だけ手動追記
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

export const SET_DEFS = {
  HYAKU:      { label: "百名山",       wikiPage: null },
  HANA_100:   { label: "花の百名山",   wikiPage: "花の百名山" },
  NIHON_200:  { label: "二百名山",     wikiPage: "日本二百名山" },
  NIHON_300:  { label: "三百名山",     wikiPage: "三百名山" },
};

export const SET_LABELS = Object.fromEntries(Object.entries(SET_DEFS).map(([k,v]) => [k, v.label]));

const WIKI_API = "https://ja.wikipedia.org/w/api.php";

function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }

function normalizeName(s){
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[（(].*?[）)]/g, "");
}

function looksMountainish(name){
  if (!name) return false;

  // namespace
  if (/^(Wikipedia|Help|Portal|Category|File|Template):/.test(name)) return false;

  // 山っぽい終端/含有（ゆるめ）
  if (/(山|岳|峰|ヶ岳|ヶ峰)/u.test(name)) return true;

  return false;
}

// “山じゃない”混入を落とす（強すぎると0件になり得るので、ほどほど）
function isClearlyNotMountain(name){
  if (!name) return true;

  // 施設・組織
  if (/(新聞|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村|空港|港|ダム)$/u.test(name)) return true;

  // 末尾がスポット系
  if (/(沼|湿原|高原|ヶ原|原|峠|岬|浜|滝|湖|川|池|渓谷|谷|社|寺|神社|公園)$/u.test(name)) return true;

  return false;
}

async function wikiParseLinks(page){
  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    origin: "*",
    page,
    prop: "links",
  });
  const url = `${WIKI_API}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const json = await res.json();
  return { url, json };
}

function extractFromParseLinks(parse){
  const links = parse?.links;
  if (!Array.isArray(links)) return { names: [], raw: [] };

  const rawTitles = links.map(l => normalizeName(l?.title)).filter(Boolean);

  const filtered = rawTitles
    .filter(looksMountainish)
    .filter(n => !isClearlyNotMountain(n));

  return { names: uniq(filtered), raw: rawTitles };
}

/**
 * 山セットの山名リストを取得（保存なし）
 * @returns {Promise<{names:string[], meta:{cached:boolean,fetchedAt:string,count:number,sample:string[], debug:any}}>}
 */
export async function loadSetNames(setKey){
  const def = SET_DEFS[setKey];
  if (!def?.wikiPage) throw new Error(`Unknown or non-wiki setKey: ${setKey}`);

  const { url, json } = await wikiParseLinks(def.wikiPage);
  const { names, raw } = extractFromParseLinks(json?.parse);

  // デバッグ：生リンク総数 / フィルタ後 / サンプル
  const debug = {
    page: def.wikiPage,
    url,
    rawCount: raw.length,
    rawSample: raw.slice(0, 10),
    filteredCount: names.length,
    filteredSample: names.slice(0, 10),
    hasParse: !!json?.parse,
    hasLinks: Array.isArray(json?.parse?.links),
  };

  return {
    names,
    meta: {
      cached: false,
      fetchedAt: new Date().toISOString(),
      count: names.length,
      sample: names.slice(0, 10),
      debug
    }
  };
}

// 互換用（ボタンから呼ばれても落ちない）
export function clearSetCache(){ /* no-op */ }
export function clearAllSetCaches(){ /* no-op */ }
