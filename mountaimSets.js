// mountaimSets.js (v8)
// 目的：Wikipediaから「山名リスト」を安定取得（0件を防ぐ）＋ localStorage Quota超過を回避
// 方針：
// - 花100/二百/三百すべて "parse&prop=links" で取得（HTML table依存を排除）
// - 「山っぽいタイトル」だけ残す（山/岳/峰/ヶ岳 など）
// - キャッシュ保存は try/catch、サイズが大きすぎる場合は保存スキップ
// - デバッグ用にサンプル10件を返せるようにする

export const GEO_OVERRIDES = {
  // 必要最小限のみ手動追加（最後の数件だけ）
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

// index.html 側が import する
export const SET_DEFS = {
  HYAKU:      { label: "百名山",       wikiPage: null },
  HANA_100:   { label: "花の百名山",   wikiPage: "花の百名山" },
  NIHON_200:  { label: "二百名山",     wikiPage: "Template:日本二百名山" },
  NIHON_300:  { label: "三百名山",     wikiPage: "Template:日本三百名山" },
};

export const SET_LABELS = Object.fromEntries(Object.entries(SET_DEFS).map(([k,v]) => [k, v.label]));

const WIKI_API = "https://ja.wikipedia.org/w/api.php";

// ★ バージョンを上げて、以前の「空キャッシュ」を読まないようにする
const CACHE_PREFIX = "mount_set_names_v8";
const CACHE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60日

// ★ 保存サイズが大きすぎるとQuota超過するので、上限を設ける（十分余裕）
const MAX_SAVE_NAMES = 450;     // 保存する最大件数
const MAX_RETURN_NAMES = 600;   // 返す最大件数（保存せず返すのはOK）

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

// 山名っぽいか（ゆるめ：取りこぼしを減らす）
function looksMountainish(name){
  if (!name) return false;

  // 明らかなノイズを除外
  if (name.startsWith("Wikipedia:") || name.startsWith("Help:") || name.startsWith("Portal:")) return false;
  if (name.startsWith("Category:") || name.startsWith("File:") || name.startsWith("Template:")) return false;

  // 組織・施設系を除外
  if (/(新聞|新聞社|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村|空港|港|ダム)$/u.test(name)) return false;

  // “山”を含む or “岳/峰”を含む（一般的な山名の大半を通す）
  if (/山|岳|峰/u.test(name)) return true;

  // 例外的に「○○ヶ岳」や「○○ヶ峰」系（normalizeで残る想定）
  if (/ヶ岳|ヶ峰/u.test(name)) return true;

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
  return obj;
}

function trySaveCache(setKey, names, meta){
  // 保存は上限までに切る（Quota対策）
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
 * @returns {Promise<{names: string[], meta: {cached:boolean, fetchedAt:string|null, count:number, sample:string[]}}>}
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

  // 返却上限（万一の巨大化対策）
  if (names.length > MAX_RETURN_NAMES) names = names.slice(0, MAX_RETURN_NAMES);

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

// デバッグ用：キャッシュ削除
export function clearSetCache(setKey){
  localStorage.removeItem(cacheKey(setKey));
}
