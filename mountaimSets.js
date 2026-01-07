// mountaimSets.js（ファイル名は既存のまま）
// 百名山以外も「同じ形式（name/lat/lng/elev/level...）」で扱えるようにするための山セット定義。
//
// ✅ 方針
// - ここには「追加で表示したい山」を書くだけ。
// - lat/lng/elev は未入力でもOK（index.html 側で Open-Meteo Geocoding により補完する）。
// - level（難易度）が未入力なら “中級” として扱う（後で手動調整してOK）。
// - 百名山と重複する山は、百名山側のデータが優先され、タグだけが追加される。

/**
 * @typedef {Object} MountainLite
 * @property {string} name
 * @property {number=} lat
 * @property {number=} lng
 * @property {number=} elev
 * @property {"初級"|"中級"|"上級"=} level
 */

/**
 * setKey は UI / 内部の識別子。
 * label は表示名。
 * tag は山オブジェクトに付与する表示用のタグ。
 */
export const MOUNTAIN_SETS = {
  HYAKU: {
    label: "百名山",
    tag: "百名山",
    items: /** @type {MountainLite[]} */ ([])
  },

  HANA_100: {
    label: "花100",
    tag: "花100",
    items: /** @type {MountainLite[]} */ ([
      { name: "秋田駒ヶ岳" },
      { name: "羊蹄山" },
      { name: "尾瀬ヶ原" },
      { name: "至仏山" },
      { name: "霧ヶ峰" },
      { name: "美ヶ原" },
      { name: "月山" },
      { name: "阿蘇山" },
      { name: "九重山" },
      { name: "大雪山" },
    ])
  },

  NIHON_200: {
    label: "二百名山",
    tag: "二百名山",
    items: /** @type {MountainLite[]} */ ([
      { name: "釈迦ヶ岳" },
      { name: "武奈ヶ岳" },
      { name: "氷ノ山" },
      { name: "御在所岳" },
      { name: "三瓶山" },
      { name: "剣山" },
      { name: "石鎚山" },
      { name: "九重山" },
      { name: "祖母山" },
      { name: "大台ヶ原山" },
    ])
  },

  NIHON_300: {
    label: "三百名山",
    tag: "三百名山",
    items: /** @type {MountainLite[]} */ ([
      { name: "大山" },
      { name: "金剛山" },
      { name: "伊吹山" },
      { name: "八経ヶ岳" },
      { name: "天城山" },
      { name: "雲取山" },
      { name: "筑波山" },
      { name: "三ツ峠山" },
      { name: "那須岳" },
      { name: "蔵王山" },
    ])
  }
};

// Geocoding が紛らわしい名前（同名地名が多い等）を“確定”させたい場合は、ここに上書き指定を置ける。
// 例：
// export const GEO_OVERRIDES = {
//   "大山": { lat: 35.371, lng: 133.546, elev: 1729 },
// };
export const GEO_OVERRIDES = {};
