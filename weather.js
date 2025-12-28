// weather.js
// ダミー天気データ生成（API差し替え前提・UI完全互換版）

export const TIME_SLOTS = [
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00"
];

// A = 良好 / B = 注意 / C = 悪天候
const SCORES = ["A", "B", "C"];

/**
 * UI / API 共通フォーマット
 * {
 *   "YYYY-MM-DD": {
 *     "06:00": "A",
 *     "08:00": "B",
 *     ...
 *   }
 * }
 */
export async function generateWeatherScore(name, lat, lng) {
  const result = {};

  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    result[dateKey] = {};

    TIME_SLOTS.forEach((time, index) => {
      // 内部は index ベースで生成
      const score = randomScore();

      // UI互換（文字列キー）
      result[dateKey][time] = score;

      // 将来API差し替え用（indexキーも保持）
      result[dateKey][index] = score;
    });
  }

  return result;
}

/* ===== utils ===== */

function getDateKey(add) {
  const d = new Date();
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function randomScore() {
  const r = Math.random();
  if (r < 0.5) return "A";
  if (r < 0.8) return "B";
  return "C";
}
