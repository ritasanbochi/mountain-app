// weather.js
// Open-Meteo 実データ版（APIキー不要）＋ UI互換フォーマット ＋ 30分キャッシュ
// Docs: Open-Meteo Forecast API  :contentReference[oaicite:2]{index=2}

export const TIME_SLOTS = ["06:00","08:00","10:00","12:00","14:00","16:00"];

// UI / API 共通フォーマット
// {
//   "YYYY-MM-DD": { "06:00":"A", "08:00":"B", ... , 0:"A", 1:"B", ... }
// }

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分

export async function generateWeatherScore(name, lat, lng) {
  // 位置は細かすぎるとキャッシュが効かないので丸め
  const rLat = round(lat, 3);
  const rLng = round(lng, 3);
  const cacheKey = `wxscore:${rLat},${rLng}`;

  // キャッシュ
  const cached = loadCache(cacheKey);
  if (cached) return cached;

  // Open-Meteo（4日分・時間帯はhourlyから拾う）
  // timezone=Asia/Tokyo で日付ズレを防ぐ
  // windspeed_unit=ms で m/s に統一  :contentReference[oaicite:3]{index=3}
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", rLat);
  url.searchParams.set("longitude", rLng);
  url.searchParams.set("hourly", [
    "temperature_2m",
    "precipitation",
    "weathercode",
    "windspeed_10m",
    "windgusts_10m"
  ].join(","));
  url.searchParams.set("forecast_days", "4");
  url.searchParams.set("timezone", "Asia/Tokyo");
  url.searchParams.set("windspeed_unit", "ms"); // m/s
  url.searchParams.set("precipitation_unit", "mm");

  const res = await fetch(url.toString());
  if (!res.ok) {
    // 失敗時は「落ちない」こと優先でダミー返す（UI維持）
    const fallback = makeDummy();
    saveCache(cacheKey, fallback);
    return fallback;
  }

  const data = await res.json();
  const scored = scoreFromOpenMeteo(data);

  saveCache(cacheKey, scored);
  return scored;
}

/* ===== スコアリング（簡易てんくら風）===== */
function scoreFromOpenMeteo(data) {
  const result = {};
  const h = data?.hourly;
  if (!h?.time || !h?.time.length) return makeDummy();

  // time: ["2025-12-28T00:00", ...]
  // 各配列は同じindexで対応
  for (let i = 0; i < h.time.length; i++) {
    const iso = h.time[i];
    const [date, hhmm] = iso.split("T"); // "YYYY-MM-DD", "HH:MM"
    if (!TIME_SLOTS.includes(hhmm)) continue;

    const temp = num(h.temperature_2m?.[i]);
    const prcp = num(h.precipitation?.[i]);     // mm/h 相当
    const wspd = num(h.windspeed_10m?.[i]);      // m/s
    const gust = num(h.windgusts_10m?.[i]);      // m/s
    const wcode = num(h.weathercode?.[i]);       // WMOコード

    const score = toABC({ temp, prcp, wspd, gust, wcode });

    if (!result[date]) result[date] = {};
    result[date][hhmm] = score;
  }

  // 「今日〜3日後」欠けがあるとUI側が困るので埋める
  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    if (!result[dateKey]) result[dateKey] = {};
    TIME_SLOTS.forEach((t, idx) => {
      const s = result[dateKey][t] ?? "C";
      result[dateKey][t] = s;
      result[dateKey][idx] = s; // 将来API差し替え用（indexキー）
    });
  }

  return result;
}

/**
 * かなりシンプルな登山向け判定（あとで調整しやすい）
 * - 強風・突風・降水で悪化
 * - 天気コードが荒れ（雷雨/大雪など）で悪化
 */
function toABC({ prcp, wspd, gust, wcode }) {
  // 明らかな荒天（雷雨、強い雪/雨）っぽいコードはC寄り
  // （open-meteoのweathercodeはWMO系）
  const severe = isSevereCode(wcode);

  // ざっくり閾値（m/s前提）
  if (severe) return "C";
  if (gust >= 18 || wspd >= 12) return "C";     // 風が強い
  if (prcp >= 2.0) return "C";                  // それなりに降る

  if (gust >= 12 || wspd >= 8) return "B";
  if (prcp >= 0.5) return "B";

  return "A";
}

function isSevereCode(code) {
  // 95-99: thunderstorm
  // 71-77: snow
  // 65-67: heavy rain 系
  if (!Number.isFinite(code)) return false;
  if (code >= 95) return true;
  if (code >= 71 && code <= 77) return true;
  if (code >= 65 && code <= 67) return true;
  return false;
}

/* ===== utils ===== */

function getDateKey(add) {
  const d = new Date();
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function makeDummy() {
  const result = {};
  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    result[dateKey] = {};
    TIME_SLOTS.forEach((t, idx) => {
      const s = "C";
      result[dateKey][t] = s;
      result[dateKey][idx] = s;
    });
  }
  return result;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, digits) {
  const p = 10 ** digits;
  return Math.round(Number(v) * p) / p;
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.ts || !obj?.data) return null;
    if (Date.now() - obj.ts > CACHE_TTL_MS) return null;
    return obj.data;
  } catch {
    return null;
  }
}

function saveCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {
    // ストレージ不可でも動作は継続
  }
}
