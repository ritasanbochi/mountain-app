// mountaimSets.js (v10)
// 目的：Wikipediaから「山名リスト」を安定取得しつつ、localStorage Quota超過を回避する
// - cacheは「小さく」「保存失敗しても処理継続」
// - 過去の空キャッシュを読まない（prefixを上げる）
// - 取得元を "links" で統一（HTML依存を減らす）
// - 混入（沼/湿原/峠/会社等）を強めに落とす

export const GEO_OVERRIDES = {
  // 最後に残ったNGだけ最小限ここへ
  // 例:
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

export const SET_DEFS = {
  HYAKU:      { label: "百名山",       wikiPage: null },
  HANA_100:   { label: "花の百名山",   wikiPage: "花の百名山" },
  // templateより「記事ページ」優先（templateは余計なリンクが混じりやすい）
  NIHON_200:  { label: "二百名山",     wikiPage: "日本二百名山" },
  NIHON_300:  { label: "三百名山",     wikiPage: "日本三百名山" },
};

export const SET_LABELS = Object.fromEntries(Object.entries(SET_DEFS).map(([k,v]) => [k, v.label]));

const WIKI_API = "https://ja.wikipedia.org/w/api.php";

// ★ prefix更新：古い/空キャッシュを読まない
const CACHE_PREFIX = "mount_set_names_v10";
const CACHE_TTL_MS = 45 * 24 * 60 * 60 * 1000; // 45日

// ★ 保存は控えめ（Quota対策）
const MAX_SAVE_NAMES = 220;   // 保存する最大件数
const MAX_RETURN_NAMES = 650; // 返す最大件数（保存しない分はOK）

function cacheKey(setKey){ return `${CACHE_PREFIX}:${setKey}`; }
function safeJsonParse(s){ try{ return JSON.parse(s); }catch{ return null; } }
function uniq(arr){ return [...new Set(arr.filter(Boolean))]; }

function normalizeName(s){
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[（(].*?[）)]/g, "");
}

// 山名っぽい判定（強め）
function looksMountainish(name){
  if (!name) return false;

  // namespace系
  if (/^(Wikipedia|Help|Portal|Category|File|Template):/.test(name)) return false;

  // 組織・施設・地名・水場等（強めに除外）
  if (/(新聞|新聞社|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村|空港|港|ダム|美術館|博物館)$/u.test(name)) return false;
  if (/(沼|湿原|高原|ヶ原|原|峠|岬|浜|滝|湖|川|池|渓谷|谷|社|寺|神社|公園)$/u.test(name)) return false;

  // 山/岳/峰 を含むものを基本採用
  if (/山|岳|峰/u.test(name)) return true;

  // 例外的な山名の補助（必要なら増やす）
  // 例: "三嶺" "三瓶山" などは上で拾える想定（山が含まれる）
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
  if (!Array.isArray(links)) return [];
  const names = [];
  for (const l of links){
    const t = normalizeName(l?.title);
    if (!t) continue;
    if (!looksMountainish(t)) continue;
    names.push(t);
  }
  return uniq(names);
}

function loadCache(setKey){
  const raw = localStorage.getItem(cacheKey(setKey));
  if (!raw) return null;
  const obj = safeJsonParse(raw);
  if (!obj?.fetchedAtMs || !Array.isArray(obj?.names)) return null;
  if (Date.now() - obj.fetchedAtMs > CACHE_TTL_MS) return null;
  // 0件キャッシュは信用しない（過去バグ対策）
  if (obj.names.length === 0) return null;
  return obj;
}

function trySaveCache(setKey, names, meta){
  const toSave = names.slice(0, MAX_SAVE_NAMES);
  const payload = {
    fetchedAt: new Date().toISOString(),
    fetchedAtMs: Date.now(),
    names: toSave,
    meta,
  };
  try{
    localStorage.setItem(cacheKey(setKey), JSON.stringify(payload));
    return true;
  }catch(e){
    console.warn("[mountaimSets] cache save skipped:", e?.name || e, setKey, toSave.length);
    return false;
  }
}

/**
 * 山セットの山名リストを取得
 * @param {"HANA_100"|"NIHON_200"|"NIHON_300"} setKey
 * @returns {Promise<{names: string[], meta: {cached:boolean, fetchedAt:string|null, count:number, sample:string[]}}>}}
 */
export async function loadSetNames(setKey){
  const def = SET_DEFS[setKey];
  if (!def?.wikiPage) throw new Error(`Unknown or non-wiki setKey: ${setKey}`);

  const cached = loadCache(setKey);
  if (cached){
    return {
      names: cached.names,
      meta: {
        cached: true,
        fetchedAt: cached.fetchedAt,
        count: cached.names.length,
        sample: cached.names.slice(0, 10),
      }
    };
  }

  const { url, json } = await wikiParseLinks(def.wikiPage);
  let names = extractFromParseLinks(json?.parse);

  if (names.length > MAX_RETURN_NAMES) names = names.slice(0, MAX_RETURN_NAMES);

  // 保存は軽量に。失敗しても返却はする
  trySaveCache(setKey, names, { url, page: def.wikiPage, mode: "links" });

  return {
    names,
    meta: {
      cached: false,
      fetchedAt: new Date().toISOString(),
      count: names.length,
      sample: names.slice(0, 10),
    }
  };
}

// 個別キャッシュ削除
export function clearSetCache(setKey){
  try{ localStorage.removeItem(cacheKey(setKey)); }catch{}
}

// 全キャッシュ削除（ボタン用）
export function clearAllSetCaches(){
  try{
    for (const k of Object.keys(SET_DEFS)){
      if (k === "HYAKU") continue;
      clearSetCache(k);
    }
  }catch{}
}
