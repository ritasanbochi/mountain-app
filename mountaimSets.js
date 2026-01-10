// mountaimSets.js
// 旧: Wikipediaから山名を集めて localStorage に貯める仕組みが QuotaExceeded を起こしやすい。
// 方針変更: 追加セットは mountains_extra.js に固定保持するため、ここは「手動上書き用」だけ残す。

export const SET_DEFS = {
  HYAKU:     { label: "百名山" },
  HANA_100:  { label: "花の百名山" },
  NIHON_200: { label: "二百名山" },
  NIHON_300: { label: "三百名山" },
};

// どうしても同名・曖昧で座標が割れた時だけ使う（基本は mountains_extra.js を直す）
export const GEO_OVERRIDES = {
  // "黒檜山": { lat: 36.5619, lng: 139.1960, elev: 1828 },
};

// 互換のために残す（呼ばれても何もしない）
export async function loadSetNames(){
  return { names: [], meta: { cached: true, note: "Disabled (use mountains_extra.js as source of truth)" } };
}
