// mountaimSets.js
// 山セット定義（座標は mountains.js / mountains_extra.js に固定）
// ※自動取得・キャッシュ機能は廃止（localStorage容量問題＆体感重視）

export const SET_DEFS = {
  HYAKU:      { label: "百名山",      order: 1 },
  HANA_100:   { label: "花の百名山",  order: 2 },
  NIHON_200:  { label: "二百名山",    order: 3 },
  NIHON_300:  { label: "三百名山",    order: 4 },
};

// 表記ゆれ等があれば最小限だけ手動で上書き
// 例: "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
export const GEO_OVERRIDES = {
};
