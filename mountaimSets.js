// mountaimSets.js
// ✅ 花の百名山 / 日本二百名山 / 日本三百名山 を Wikipedia から取得して山名配列にする（フロントのみ）
// - Wikipedia API (parse) で HTML を取り、DOMParser でテーブル/リストから山名を抽出
// - 「番号 / 1 / 2 / 3 ...」みたいな列は徹底的に除外
// - localStorage にキャッシュ（7日）
//
// export:
//  - SET_DEFS
//  - loadSetNames(setKey)
//  - GEO_OVERRIDES（座標の手動補正）
//
// ※ ファイル名が mountaimSets.js（typo含む）でもOK。index.html 側の import と一致させること。

const WIKI_API = "https://ja.wikipedia.org/w/api.php";
const CACHE_PREFIX = "mount_set_v2_";
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
function saveCache(setKey, names){
  const obj = { fetchedAt: nowIso(), names };
  try { localStorage.setItem(cacheKey(setKey), JSON.stringify(obj)); } catch {}
}

function cleanName(s){
  return String(s ?? "")
    .replace(/\[[0-9]+\]/g, "")          // 脚注 [1]
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[（(].*?[）)]/g, "")      // 括弧書き除去
    .trim();
}

function looksLikeNumberOnly(s){
  const t = String(s ?? "").trim();
  if (!t) return true;
  if (t === "番号") return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}

function isBadName(s){
  const t = cleanName(s);
  if (!t) return true;
  if (looksLikeNumberOnly(t)) return true;

  // よくあるヘッダ語
  const bad = ["山名", "標高", "所在地", "都道府県", "備考", "番号", "No.", "No"];
  if (bad.includes(t)) return true;

  // 異常に短い/記号だけ
  if (t.length <= 1) return true;
  if (/^[\-\—–・]+$/.test(t)) return true;

  return false;
}

/** Wikipedia parse APIでページHTML取得 */
async function fetchWikiHtml(pageTitle){
  const params = new URLSearchParams({
    action: "parse",
    page: pageTitle,
    prop: "text",
    format: "json",
    origin: "*",
  });
  const url = `${WIKI_API}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wiki parse failed: ${res.status}`);
  const j = await res.json();
  const html = j?.parse?.text?.["*"];
  if (!html) throw new Error("wiki parse: no html");
  return html;
}

function parseHtmlToDoc(html){
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

/**
 * 1) テーブル（wikitable）から山名列を推定して抽出
 * 2) ダメなら ol/li などのリストから抽出
 */
function extractNamesFromDoc(doc){
  const names = [];

  // --- 1) table.wikitable を探す ---
  const tables = [...doc.querySelectorAll("table.wikitable, table.sortable, table")];

  for (const table of tables){
    const rows = [...table.querySelectorAll("tr")];
    if (rows.length < 5) continue;

    // ヘッダ行から「山名っぽい列」を推定
    let nameCol = -1;
    const headerCells = [...rows[0].querySelectorAll("th,td")].map(c => cleanName(c.textContent));
    headerCells.forEach((h, idx) => {
      if (h.includes("山名")) nameCol = idx;
    });

    // 推定できない場合：リンクが多い列を選ぶ（番号列対策）
    if (nameCol === -1){
      const colScores = new Map();
      for (let r = 1; r < Math.min(rows.length, 20); r++){
        const cells = [...rows[r].querySelectorAll("th,td")];
        cells.forEach((c, idx) => {
          const txt = cleanName(c.textContent);
          if (looksLikeNumberOnly(txt)) return; // 番号列はスコアに入れない
          const linkCount = c.querySelectorAll("a").length;
          const score = (colScores.get(idx) || 0) + (linkCount > 0 ? 2 : 1);
          colScores.set(idx, score);
        });
      }
      // 最大スコアの列を採用
      let bestIdx = -1, bestScore = -1;
      for (const [idx, sc] of colScores.entries()){
        if (sc > bestScore){ bestScore = sc; bestIdx = idx; }
      }
      nameCol = bestIdx;
    }

    if (nameCol === -1) continue;

    // 行ごとに山名抽出
    const local = [];
    for (let r = 1; r < rows.length; r++){
      const cells = [...rows[r].querySelectorAll("th,td")];
      if (!cells.length) continue;

      const cell = cells[nameCol] || cells[0];
      if (!cell) continue;

      // リンクテキスト優先（脚注や余計な文を避けやすい）
      let cand = "";
      const a = cell.querySelector("a");
      if (a && a.textContent) cand = a.textContent;
      else cand = cell.textContent;

      const nm = cleanName(cand);
      if (isBadName(nm)) continue;

      local.push(nm);
    }

    // ある程度取れたテーブルだけ採用
    if (local.length >= 30){
      names.push(...local);
      break; // まずは最初に当たった“それっぽい”テーブルで確定
    }
  }

  // --- 2) fallback: ol/li ---
  if (names.length < 30){
    const lis = [...doc.querySelectorAll("ol li, ul li")];
    const local = [];
    for (const li of lis){
      // liの先頭リンクが山名のことが多い
      const a = li.querySelector("a");
      const cand = cleanName(a?.textContent || li.textContent);
      if (isBadName(cand)) continue;
      // “○○岳”“○○山”などの形を軽く優先
      if (cand.length >= 2) local.push(cand);
    }
    if (local.length >= 30) names.push(...local);
  }

  // 重複除去
  const uniq = [];
  const seen = new Set();
  for (const n of names){
    const key = n.replace(/\s+/g,"");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(n);
  }

  return uniq;
}

/** セット定義 */
export const SET_DEFS = {
  HANA_100:  { label: "花の百名山", page: "花の百名山" },
  NIHON_200: { label: "日本二百名山", page: "日本二百名山" },
  NIHON_300: { label: "日本三百名山", page: "日本三百名山" },
};

/** 座標の手動補正（ここに追記していく） */
export const GEO_OVERRIDES = {
  // 例:
  // "燧ヶ岳": { lat: 36.955, lng: 139.285, elev: 2356 },
};

/**
 * 山名一覧を取得（キャッシュ優先）
 * return: { names: string[], meta: { cached: boolean, fetchedAt: string } }
 */
export async function loadSetNames(setKey){
  const def = SET_DEFS?.[setKey];
  if (!def) return { names: [], meta: { cached: false, fetchedAt: nowIso() } };

  const cached = loadCache(setKey);
  if (cached){
    return {
      names: cached.names,
      meta: { cached: true, fetchedAt: cached.fetchedAt }
    };
  }

  const html = await fetchWikiHtml(def.page);
  const doc = parseHtmlToDoc(html);
  const names = extractNamesFromDoc(doc);

  // 🔥 ここが重要：壊れて「番号/1/2/3」みたいなものしか取れてないときは names が激減する
  // その場合はキャッシュしない（壊れた結果を固定化しない）
  const valid = names.filter(n => !isBadName(n));
  if (valid.length >= 30){
    saveCache(setKey, valid);
  }

  return {
    names: valid,
    meta: { cached: false, fetchedAt: nowIso() }
  };
}
