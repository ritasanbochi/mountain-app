// mountaimSets.js
// - Wikipedia REST API から「花の百名山」「日本二百名山(追加100)」の“山名リスト”を取得
// - 国土地理院 1003山 CSV から name -> (lat,lon,elev) を引いて mountains_extra.js を生成
// - localStorage に巨大保存しない（QuotaExceeded 回避）

const WIKI_REST = "https://ja.wikipedia.org/api/rest_v1/page/html/";

function normName(s){
  return String(s || "")
    .replace(/\s+/g, "")
    .replace(/[\u3000]/g, "")
    .replace(/（.*?）/g, "")
    .replace(/＜.*?＞/g, "")
    .replace(/［.*?］/g, "")
    .trim();
}

async function fetchHtml(title){
  // REST v1 は CORS が通りやすい
  const url = WIKI_REST + encodeURIComponent(title);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Wikipedia REST fetch failed: ${title} (${res.status})`);
  return await res.text();
}

// 花の百名山: 本文の wikitable から「山名」列を抽出
function parseHana100(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  const table = doc.querySelector("table.wikitable");
  if (!table) throw new Error("花の百名山: wikitable が見つかりません");
  const rows = [...table.querySelectorAll("tr")].slice(1);
  const names = [];
  for (const tr of rows){
    const tds = tr.querySelectorAll("td");
    if (tds.length < 2) continue;
    const cell = tds[1];
    const a = cell.querySelector("a");
    const name = normName(a ? a.textContent : cell.textContent);
    if (name) names.push(name);
  }
  return names;
}

// 日本二百名山(追加100): Template:日本二百名山 の navbox から山リンクだけ抽出
function parseNihon200Extra(html){
  const doc = new DOMParser().parseFromString(html, "text/html");
  const navbox = doc.querySelector("div.navbox");
  if (!navbox) throw new Error("Template:日本二百名山: navbox が見つかりません");

  const skip = new Set(["表","話","編","歴","日本二百名山","百名山","日本百名山","日本三百名山","日本の山一覧",
                        "北海道","東北","関東","中部山岳","西日本"]);
  const names = [];
  const anchors = [...navbox.querySelectorAll("a[href^='./'] , a[href^='/wiki/']")];
  for (const a of anchors){
    const t = normName(a.textContent);
    if (!t || skip.has(t)) continue;

    // カテゴリ的リンクの除外（末尾に “山地/丘陵/連峰” 等）
    if (/(の山|山地|丘陵|山脈|連峰|火山地)$/.test(t)) continue;
    if (t.startsWith("Template:")) continue;

    // “日本百名山”へのリンク以降が混ざるケース対策
    if (t === "日本百名山") break;

    names.push(t);
  }

  // unique preserve
  const seen = new Set();
  const out = [];
  for (const n of names){
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  // Template から取れるのは “追加100” のはず（100件）
  return out;
}

export async function fetchSetNamesViaRest(){
  const [hanaHtml, n200TplHtml] = await Promise.all([
    fetchHtml("花の百名山"),
    fetchHtml("Template:日本二百名山"),
  ]);

  const HANA_100 = parseHana100(hanaHtml);
  const NIHON_200_EXTRA = parseNihon200Extra(n200TplHtml);

  return { HANA_100, NIHON_200_EXTRA };
}

async function fetchGsi1003Csv(){
  const url = "https://www.gsi.go.jp/KOKUJYOHO/MOUNTAIN/1003zan20250401.csv";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`GSI 1003 CSV fetch failed (${res.status})`);
  return await res.text();
}

// 超簡易CSVパーサ（GSI 1003 はカンマ区切り＆引用符少なめ）
function parseCsv(csvText){
  const lines = csvText.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  const rows = [];
  for (let i=1;i<lines.length;i++){
    const cols = lines[i].split(",");
    const obj = {};
    for (let j=0;j<header.length;j++){
      obj[header[j]] = cols[j];
    }
    rows.push(obj);
  }
  return rows;
}

function buildGsiMap(rows){
  // name -> best row（標高が高い方優先）
  const map = new Map();
  for (const r of rows){
    const name = normName(r["山名＜山頂名＞"]);
    const elev = Number(String(r["標高値(m)"]).replace(/[^0-9.]/g,""));
    const lat  = Number(r["緯度"]);
    const lon  = Number(r["経度"]);
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const prev = map.get(name);
    if (!prev || elev > prev.elev){
      map.set(name, { name, elev, lat, lon });
    }
  }
  return map;
}

function tryLookup(gsiMap, name){
  const candidates = [
    name,
    name.replace(/ヶ/g,"ケ"),
    name.replace(/ケ/g,"ヶ"),
    name.replace(/ノ/g,"の"),
    name.replace(/の/g,"ノ"),
  ].map(normName);

  for (const c of candidates){
    const hit = gsiMap.get(c);
    if (hit) return hit;
  }

  // 典型的な表記ゆれだけ最小限ハードコード（必要なら増やす）
  const ALIAS = {
    "大菩薩峠": "大菩薩嶺",
  };
  const ali = ALIAS[normName(name)];
  if (ali){
    const hit = gsiMap.get(normName(ali));
    if (hit) return hit;
  }
  return null;
}

function makeId(prefix, name){
  // 既存と衝突しない “extra_” 系
  return `${prefix}_${encodeURIComponent(name).replace(/%/g,"_")}`;
}

export async function buildMountainsExtraViaGSI(setNames){
  const csv = await fetchGsi1003Csv();
  const rows = parseCsv(csv);
  const gsiMap = buildGsiMap(rows);

  const out = [];
  const ng = [];

  // 花100
  let hanaOk = 0;
  for (const name of setNames.HANA_100){
    const hit = tryLookup(gsiMap, name);
    if (!hit){
      ng.push(name);
      continue;
    }
    hanaOk++;
    out.push({
      id: makeId("hana", name),
      name,
      lat: hit.lat,
      lon: hit.lon,
      elev: hit.elev,
      level: "中級", // ここは後で精緻化できる
      _sets: ["HANA_100"],
    });
  }

  // 二百(追加100) ※百名山側は mountains.js が持っている前提
  let n200Ok = 0;
  for (const name of setNames.NIHON_200_EXTRA){
    const hit = tryLookup(gsiMap, name);
    if (!hit){
      ng.push(name);
      continue;
    }
    n200Ok++;
    out.push({
      id: makeId("n200", name),
      name,
      lat: hit.lat,
      lon: hit.lon,
      elev: hit.elev,
      level: "中級",
      _sets: ["NIHON_200"],
    });
  }

  const stats = {
    hanaOk, hanaTotal: setNames.HANA_100.length,
    n200Ok, n200Total: setNames.NIHON_200_EXTRA.length,
    ngExamples: ng.slice(0, 20),
  };

  // JS生成（百名山と同じ“オブジェクト配列 + export default”形式）
  const jsText =
`// mountains_extra.js
// generated at: ${new Date().toISOString()}
// 花の百名山 / 日本二百名山(追加100) の座標・標高を固定保持（GSI 1003山CSVベース）
const mountainsExtra = ${JSON.stringify(out, null, 2)};
export default mountainsExtra;
`;

  return { jsText, stats };
}
