// weather.js
// Open-Meteo 実データ版（GitHub Pages対応・APIキー不要）

export const TIME_SLOTS = [
  "06:00",
  "08:00",
  "10:00",
  "12:00",
  "14:00",
  "16:00"
];

/**
 * Open-Meteo API から天気を取得し
 * UI互換フォーマットで A/B/C を返す
 *
 * {
 *   "YYYY-MM-DD": {
 *     "06:00": "A",
 *     "08:00": "B",
 *     ...
 *   }
 * }
 */
export async function generateWeatherScore(name, lat, lng) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lng}` +
    `&hourly=precipitation,windspeed_10m,cloudcover` +
    `&forecast_days=4` +
    `&timezone=Asia/Tokyo`;

  const res = await fetch(url);
  const data = await res.json();

  const result = {};

  data.hourly.time.forEach((isoTime, i) => {
    const date = isoTime.slice(0, 10);
    const hour = isoTime.slice(11, 16);

    if (!TIME_SLOTS.includes(hour)) return;

    if (!result[date]) result[date] = {};

    const rain = data.hourly.precipitation[i]; // mm
    const wind = data.hourly.windspeed_10m[i]; // m/s

    result[date][hour] = scoreFromWeather(rain, wind);
  });

  return result;
}

/* ===== スコア判定 ===== */
function scoreFromWeather(rain, wind) {
  if (rain < 0.5 && wind < 8) return "A";
  if (rain < 3 && wind < 12) return "B";
  return "C";
}
