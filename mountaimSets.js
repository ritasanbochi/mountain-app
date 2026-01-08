// mountaimSets.js (v3)
// Wikipedia から 花100 / 二百 / 三百 の山名一覧を取得して返す（フロントのみ）
// - 番号列・標高列を誤抽出しないよう列推定を強化
// - localStorage にキャッシュ（7日）
//
// export:
//  - SET_DEFS
//  - loadSetNames(setKey)
//  - GEO_OVERRIDES

const WIKI_API = "https://ja.wikipedia.org/w/api.php";
const CACHE_PREFIX = "mount_set_v3_";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nowIso(){ return new Date().toISOString(); }
function safeJsonParse(s){ try{ return JSON.parse(s); }catch{ return null; } }

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
  try{
    localStorage.setItem(cacheKey(setKey), JSON.stringify({ fetchedAt: nowIso(), names }));
  }catch{}
}

function cleanName(s){
  return String(s ?? "")
    .replace(/\[[0-9]+\]/g, "")      // 脚注 [1]
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[（(].*?[）)]/g, "")  // 括弧除去
    .trim();
}

function looksLikeNumberOnly(s){
  const t = String(s ?? "").trim();
  if (!t) return true;
  if (t === "番号" || t === "No." || t === "No") return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}
function looksLikeElevation(s){
  const t = String(s ?? "").trim();
  if (!t) return false;
  // 599m / 1,405m / 1700 m / 1700m級
  if (/^\d{1,3}(,\d{3})*m$/i.test(t)) return true;
  if (/^\d+(\.\d+)?m$/i.test(t)) return true;
  if (t.includes("標高")) return true;
  if (t.endsWith("m")) return true;
  return false;
}
function containsMountainWord(s){
  const t = String(s ?? "");
  // “山” は地名にも混ざるので、岳/峰/ヶ岳なども含めて加点
  return /[山岳峰ヶ]/.test(t);
}

function isBadName(s){
  const t = cleanName(s);
  if (!t) return true;
  if (looksLikeNumberOnly(t)) return true;
  if (looksLikeElevation(t)) return true;

  const badHeaders = ["山名", "標高", "所在地", "都道府県", "備考", "番号", "No.", "No", "m", "標高m"];
  if (badHeaders.includes(t)) return true;

  if (t.length <= 1) return true;
  if (/^[\-\—–・]+$/.test(t)) return true;

  // ほぼ数字記号だけ
  if (!/[ぁ-んァ-ン一-龯]/.test(t)) return true;

  return false;
}

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
  return new DOMParser().parseFromString(html, "text/html");
}

/** テーブルから「山名列」を推定して山名を抽出する */
function extractFromTable(table){
  const rows = [...table.querySelectorAll("tr")];
  if (rows.length < 5) return [];

  // ヘッダ行を最初の3行から探す（ページによって複数段ヘッダがある）
  let headerRow = null;
  for (let i = 0; i < Math.min(3, rows.length); i++){
    const cells = [...rows[i].querySelectorAll("th,td")];
    const texts = cells.map(c => cleanName(c.textContent));
    if (texts.some(t => t.includes("山名"))) { headerRow = rows[i]; break; }
  }

  let nameCol = -1;
  if (headerRow){
    const cells = [...headerRow.querySelectorAll("th,td")];
    const texts = cells.map(c => cleanName(c.textContent));
    texts.forEach((t, idx) => {
      if (t.includes("山名")) nameCol = idx;
    });
  }

  // 見つからなければ列スコアリング
  if (nameCol === -1){
    const colCount = Math.max(...rows.slice(0, 6).map(r => r.querySelectorAll("th,td").length));
    const scores = new Array(colCount).fill(0);

    // サンプル行（データ行）を見て、山名っぽい列を決める
    const sampleRows = rows.slice(1, Math.min(rows.length, 25));
    for (const r of sampleRows){
      const cells = [...r.querySelectorAll("th,td")];
      for (let i = 0; i < colCount; i++){
        const c = cells[i];
        if (!c) continue;
        const txtRaw = cleanName(c.textContent);
        const linkCount = c.querySelectorAll("a").length;

        // 基本：リンクがある列は強く加点
        if (linkCount > 0) scores[i] += 3;

        // 文字（日本語）を含む列は加点
        if (/[ぁ-んァ-ン一-龯]/.test(txtRaw)) scores[i] += 1;

        // 山っぽい語がある列は加点
        if (containsMountainWord(txtRaw)) scores[i] += 2;

        // 数字だけ/標高っぽいのは強く減点
        if (looksLikeNumberOnly(txtRaw)) scores[i] -= 6;
        if (looksLikeElevation(txtRaw)) scores[i] -= 8;

        // ほぼ数字・記号だけも減点
        if (!/[ぁ-んァ-ン一-龯]/.test(txtRaw)) scores[i] -= 2;
      }
    }

    // 最大スコア列を採用
    let bestIdx = -1, bestScore = -1e9;
    for (let i = 0; i < scores.length; i++){
      if (scores[i] > bestScore){
        bestScore = scores[i];
        bestIdx = i;
      }
    }
    nameCol = bestIdx;
  }

  if (nameCol === -1) return [];

  // 抽出
  const names = [];
  for (let r = 1; r < rows.length; r++){
    const cells = [...rows[r].querySelectorAll("th,td")];
    if (!cells.length) continue;

    const cell = cells[nameCol] || cells[0];
    if (!cell) continue;

    // リンク優先
    const a = cell.querySelector("a");
    const cand = cleanName(a?.textContent || cell.textContent);
    if (isBadName(cand)) continue;
    names.push(cand);
  }
  return names;
}

function extractNamesFromDoc(doc){
  const names = [];

  // まず wikitable 系
  const tables = [...doc.querySelectorAll("table.wikitable, table.sortable, table")];
  for (const t of tables){
    const local = extractFromTable(t);
    if (local.length >= 30){
      names.push(...local);
      break;
    }
  }

  // fallback: リストから（テーブルが取れないとき用）
  if (names.length < 30){
    const lis = [...doc.querySelectorAll("ol li, ul li")];
    const local = [];
    for (const li of lis){
      const a = li.querySelector("a");
      const cand = cleanName(a?.textContent || li.textContent);
      if (isBadName(cand)) continue;
      if (cand.length >= 2) local.push(cand);
    }
    if (local.length >= 30) names.push(...local);
  }

  // 重複除去
  const uniq = [];
  const seen = new Set();
  for (const n of names){
    const key = n.replace(/\s+/g, "");
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

/** 座標の手動補正 */
export const GEO_OVERRIDES = {
  // 例:
  // "燧ヶ岳": { lat: 36.955, lng: 139.285, elev: 2356 },
};

export async function loadSetNames(setKey){
  const def = SET_DEFS?.[setKey];
  if (!def) return { names: [], meta: { cached: false, fetchedAt: nowIso() } };

  const cached = loadCache(setKey);
  if (cached){
    return { names: cached.names, meta: { cached: true, fetchedAt: cached.fetchedAt } };
  }

  const html = await fetchWikiHtml(def.page);
  const doc = parseHtmlToDoc(html);
  const names = extractNamesFromDoc(doc);

  // 壊れた抽出（標高列など）をキャッシュしないよう、最低件数を要求
  const valid = names.filter(n => !isBadName(n));
  if (valid.length >= 30) saveCache(setKey, valid);

  return { names: valid, meta: { cached: false, fetchedAt: nowIso() } };
}
