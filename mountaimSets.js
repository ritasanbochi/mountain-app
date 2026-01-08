// mountaimSets.js
// 山セットの「山名リスト取得」と「座標手入力の上書き」を管理
// - 山名リストは Wikipedia から取得して localStorage にキャッシュ
// - GitHub Pages 等のフロントのみで動く前提

export const GEO_OVERRIDES = {
  // 自動取得で最後まで取れないやつだけ、必要最小限で手動追加
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

// ★ index.html が import する想定の “定義” をここで正式に export する
export const SET_DEFS = {
  HYAKU:      { label: "百名山",       wikiPage: null },
  HANA_100:   { label: "花の百名山",   wikiPage: "花の百名山" },
  NIHON_200:  { label: "二百名山",     wikiPage: "日本二百名山" },
  NIHON_300:  { label: "三百名山",     wikiPage: "日本三百名山" },
};

// 互換用：既存コード資産が参照していても壊れないよう残す
export const SET_LABELS = Object.fromEntries(
  Object.entries(SET_DEFS).map(([k,v]) => [k, v.label])
);

// localStorage キャッシュ設定
const CACHE_PREFIX = "mount_set_names_v5";
const CACHE_TTL_DAYS = 60; // 2か月くらいで十分
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function nowMs(){ return Date.now(); }
function cacheKey(setKey){ return `${CACHE_PREFIX}:${setKey}`; }
function safeJsonParse(s){ try{ return JSON.parse(s); }catch{ return null; } }
function uniq(arr){ return [...new Set(arr)]; }

function normalizeName(s){
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "");
}

// 山名っぽくない混入を弾く（最低限 + 強化）
function looksBadName(name){
  return /(新聞|新聞社|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村|空港|港|ダム|湖|寺|神社)$/u.test(name);
}

// “山っぽさ” 判定
function looksMountainish(name, setKey){
  if (!name) return false;
  if (looksBadName(name)) return false;

  // 「山/岳/峰」が含まれるか（末尾だけに限定しない）
  const hasMountainWord = /山|岳|峰/u.test(name);

  if (setKey === "HANA_100"){
    // 花100はスポット混入が多いので緩めに通すが、
    // 明らかに山じゃない語尾は落とす（後段の座標取得の負担減）
    if (/(沼|湿原|高原|ヶ原|原|峠|岬|浜|滝|湖)$/u.test(name) && !hasMountainWord) return false;
    return hasMountainWord || name.length <= 10;
  }
  return hasMountainWord;
}

async function fetchWikiHtml(pageTitle){
  const url =
    "https://ja.wikipedia.org/w/api.php" +
    "?action=parse&format=json&origin=*" +
    "&prop=text" +
    "&page=" + encodeURIComponent(pageTitle);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const json = await res.json();
  const html = json?.parse?.text?.["*"];
  if (!html) throw new Error("Wikipedia parse text missing");
  return html;
}

function extractNamesFromWikiHtml(html, setKey){
  const doc = new DOMParser().parseFromString(html, "text/html");

  const candidates = [];
  const seen = new Set();

  // テーブル/リスト優先
  const scopes = [...doc.querySelectorAll("table.wikitable, table.sortable, ul, ol")];

  for (const scope of scopes){
    const links = scope.querySelectorAll("a[title]");
    for (const a of links){
      const t = a.getAttribute("title");
      if (!t) continue;

      // Wikipediaの特殊リンク除外
      if (t.startsWith("Help:") || t.startsWith("Category:") || t.startsWith("File:")) continue;

      const n = normalizeName(t);
      if (!n || n.length < 2) continue;
      if (seen.has(n)) continue;

      if (!looksMountainish(n, setKey)) continue;

      seen.add(n);
      candidates.push(n);
    }
  }

  // 少なければ全体リンクから保険
  if (candidates.length < 50){
    const links = doc.querySelectorAll("a[title]");
    for (const a of links){
      const t = a.getAttribute("title");
      if (!t) continue;
      if (t.startsWith("Help:") || t.startsWith("Category:") || t.startsWith("File:")) continue;

      const n = normalizeName(t);
      if (!n || n.length < 2) continue;
      if (seen.has(n)) continue;

      if (!looksMountainish(n, setKey)) continue;

      seen.add(n);
      candidates.push(n);
    }
  }

  const cleaned = candidates.filter(n => !looksBadName(n));
  return uniq(cleaned);
}

/**
 * 山セットの山名リストを取得（Wikipedia→localStorage cache）
 * @param {"HANA_100"|"NIHON_200"|"NIHON_300"} setKey
 * @returns {Promise<{names: string[], meta: {cached: boolean, fetchedAt: string, count: number}}>}
 */
export async function loadSetNames(setKey){
  const def = SET_DEFS[setKey];
  if (!def?.wikiPage) throw new Error(`Unknown or non-wiki setKey: ${setKey}`);

  const key = cacheKey(setKey);
  const cached = safeJsonParse(localStorage.getItem(key));

  if (cached?.names?.length && cached?.fetchedAtMs && (nowMs() - cached.fetchedAtMs) < CACHE_TTL_MS){
    return {
      names: cached.names,
      meta: { cached: true, fetchedAt: cached.fetchedAt, count: cached.names.length }
    };
  }

  const html = await fetchWikiHtml(def.wikiPage);
  const names = extractNamesFromWikiHtml(html, setKey);

  const payload = {
    setKey,
    page: def.wikiPage,
    fetchedAt: new Date().toISOString(),
    fetchedAtMs: nowMs(),
    names,
  };
  localStorage.setItem(key, JSON.stringify(payload));

  return {
    names,
    meta: { cached: false, fetchedAt: payload.fetchedAt, count: names.length }
  };
}

/** デバッグ用途：キャッシュ削除 */
export function clearSetCache(setKey){
  localStorage.removeItem(cacheKey(setKey));
}
