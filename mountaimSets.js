// mountaimSets.js
// index.html が期待する export を提供する互換レイヤー。
// 方針：山名リストは「コード内に固定」。localStorage も Wikipedia 取得も使わない。
// （QuotaExceededError や自動取得失敗の根本を避ける）

// 座標が取れない/表記ゆれがある山だけ、必要最小限で上書きできる辞書
// 例: "黒檜山": { lat: 36.5609, lng: 139.1936, elev: 1828 },
export const GEO_OVERRIDES = {};

// セット定義（index.html が setLabel() で参照）
// ※names は「山名のリスト」。ここは “山名だけ” を保持する用途。
// ※座標は mountains_extra.js 側で固定する方針のため、ここは山名だけでOK。
export const SET_DEFS = {
  HYAKU: {
    label: "百名山",
    names: [], // mountains.js 側にある前提（ここは空でOK）
  },
  HANA_100: {
    label: "花の百名山",
    names: [
      // 必要ならここに「花100の山名」だけを入れる（座標は mountains_extra.js に持たせる）
      // 例（ダミー/動作確認用。あなたの完全リストで置き換え推奨）
      "至仏山","霧ヶ峰","美ヶ原","月山","秋田駒ヶ岳","羊蹄山","阿蘇山","大雪山"
    ],
  },
  NIHON_200: {
    label: "二百名山",
    names: [
      // 例（ダミー/動作確認用。あなたの完全リストで置き換え推奨）
      "釈迦ヶ岳","武奈ヶ岳","氷ノ山","大台ヶ原山","御在所岳",
      "三瓶山","剣山","石鎚山","九重山","祖母山"
    ],
  },
  NIHON_300: {
    label: "三百名山",
    names: [
      // 例（ダミー/動作確認用。あなたの完全リストで置き換え推奨）
      "大山","金剛山","伊吹山","八経ヶ岳","天城山",
      "雲取山","筑波山","三ツ峠山","那須岳","蔵王山"
    ],
  },
};

// 旧名互換（過去コードが MOUNTAIN_SETS を参照しても動くように）
export const MOUNTAIN_SETS = {
  HYAKU: SET_DEFS.HYAKU.names,
  HANA_100: SET_DEFS.HANA_100.names,
  NIHON_200: SET_DEFS.NIHON_200.names,
  NIHON_300: SET_DEFS.NIHON_300.names,
};

// index.html が呼んでいる関数（戻り値形式も合わせる）
// meta.cached は「キャッシュかどうか」を示すだけなので、常に true 扱いにしておく。
export async function loadSetNames(setKey) {
  const def = SET_DEFS[setKey];
  if (!def) {
    return { names: [], meta: { cached: true, source: "code", setKey } };
  }
  // names はコピーを返す（呼び出し側で破壊されても安全）
  return { names: [...(def.names || [])], meta: { cached: true, source: "code", setKey } };
}
