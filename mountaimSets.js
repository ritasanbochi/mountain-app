// mountaimSets.js
// 山セットの「山名リスト取得」と「座標手入力の上書き」を管理
// - 山名リストは Wikipedia から取得して localStorage にキャッシュ
// - ここはフロントのみで動く前提（GitHub Pages OK）

export const GEO_OVERRIDES = {
  // 自動取得で最後まで取れないやつだけ、必要最小限で手動追加
  // "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
};

export const SET_LABELS = {
  HYAKU: "百名山",
  HANA_100: "花の百名山",
  NIHON_200: "二百名山",
  NIHON_300: "三百名山",
};

// Wikipediaページ名（日本語版）
const SET_WIKI_PAGES = {
  HANA_100: "花の百名山",
  NIHON_200: "日本二百名山",
  NIHON_300: "日本三百名山",
};

// localStorage キャッシュ設定
const CACHE_PREFIX = "mount_set_names_v4";
const CACHE_TTL_DAYS = 60; // 2か月くらいで十分
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

function nowMs() { return Date.now(); }

function cacheKey(setKey) {
  return `${CACHE_PREFIX}:${setKey}`;
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function uniq(arr) {
  return [...new Set(arr)];
}

function normalizeName(s) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "");
}

// 山名っぽくない混入を弾く（最低限）
function looksBadName(name) {
  return /(新聞|新聞社|会社|株式会社|協会|連盟|財団|法人|大学|研究所|病院|鉄道|駅|市|町|村)$/u.test(name);
}

// 「山/岳/峰」っぽいキーワード（HANAはスポット混入もあるので少し緩め）
function looksMountainish(name, setKey) {
  if (!name) return false;
  if (looksBadName(name)) return false;

  // まずは末尾 or 含むで山っぽさを見る
  const mountainWord = /山|岳|峰/u.test(name);

  if (setKey === "HANA_100") {
    // 花100は「○○ヶ原」「○○沼」等が混じりやすいので、
    // いったん “緩め” に通して、後段（座標取得側の除外）でコントロールする
    return mountainWord || name.length <= 10;
  }
  return mountainWord;
}

async function fetchWikiHtml(pageTitle) {
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

function extractNamesFromWikiHtml(html, setKey) {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Wikipedia内リンク（aタグ）からタイトルを拾う方針
  // ただし本文中の関係ないリンクも混じるので、表やリスト優先のフィルタをする
  const candidates = [];

  // まずはテーブル（infobox以外）とリストを優先
  const scopes = [
    ...doc.querySelectorAll("table.wikitable, table.sortable, ul, ol"),
  ];

  const seen = new Set();

  for (const scope of scopes) {
    const links = scope.querySelectorAll("a[title]");
    for (const a of links) {
      const t = a.getAttribute("title");
      if (!t) continue;

      // Wikipediaの特殊リンク除外
      if (t.startsWith("Help:") || t.startsWith("Category:") || t.startsWith("File:")) continue;

      const n = normalizeName(t);
      if (!n || n.length < 2) continue;
      if (seen.has(n)) continue;

      // セット別に山っぽさフィルタ
      if (!looksMountainish(n, setKey)) continue;

      seen.add(n);
      candidates.push(n);
    }
  }

  // それでも少ないときは全体リンクも保険で拾う
  if (candidates.length < 50) {
    const links = doc.querySelectorAll("a[title]");
    for (const a of links) {
      const t = a.getAttribute("title");
      const n = normalizeName(t);
      if (!n || n.length < 2) continue;
      if (seen.has(n)) continue;
      if (!looksMountainish(n, setKey)) continue;
      seen.add(n);
      candidates.push(n);
    }
  }

  // さらに軽く整形（混入っぽいのを最後に削る）
  const cleaned = candidates.filter(n => !looksBadName(n));
  return uniq(cleaned);
}

/**
 * 山セットの山名リストを取得（Wikipedia→localStorage cache）
 * @param {"HANA_100"|"NIHON_200"|"NIHON_300"} setKey
 * @returns {Promise<{names: string[], meta: {cached: boolean, fetchedAt: string, count: number}}>}
 */
export async function loadSetNames(setKey) {
  const page = SET_WIKI_PAGES[setKey];
  if (!page) throw new Error(`Unknown setKey: ${setKey}`);

  const key = cacheKey(setKey);
  const cached = safeJsonParse(localStorage.getItem(key));

  if (cached?.names?.length && cached?.fetchedAtMs && (nowMs() - cached.fetchedAtMs) < CACHE_TTL_MS) {
    return {
      names: cached.names,
      meta: {
        cached: true,
        fetchedAt: cached.fetchedAt,
        count: cached.names.length,
      }
    };
  }

  const html = await fetchWikiHtml(page);
  const names = extractNamesFromWikiHtml(html, setKey);

  const payload = {
    setKey,
    page,
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
export function clearSetCache(setKey) {
  localStorage.removeItem(cacheKey(setKey));
}
