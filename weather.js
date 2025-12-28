// weather.js
// Open-Meteo 実データ版（APIキー不要）＋ UI互換フォーマット
// 失敗時はダミーを返し、_meta で判別可能にする

export const TIME_SLOTS = ["06:00","08:00","10:00","12:00","14:00","16:00"];

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分
const scorePriority = { A:3, B:2, C:1 };

export async function generateWeatherScore(name, lat, lng) {
  const rLat = round(lat, 3);
  const rLng = round(lng, 3);
  const cacheKey = `wxscore:${rLat},${rLng}`;

  // キャッシュ
  const cached = loadCache(cacheKey);
  if (cached) {
    // cached でも meta は残しておく
    cached._meta = { ...(cached._meta || {}), cache: "hit" };
    return cached;
  }

  try {
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
    url.searchParams.set("windspeed_unit", "ms");
    url.searchParams.set("precipitation_unit", "mm");

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const data = await res.json();
    const scored = scoreFromOpenMeteo(data);

    scored._meta = {
      source: "api",
      fetchedAt: new Date().toISOString(),
      lat: rLat,
      lng: rLng,
      cache: "miss"
    };

    saveCache(cacheKey, scored);
    return scored;
  } catch (e) {
    const fallback = makeDummy();
    fallback._meta = {
      source: "dummy",
      fetchedAt: new Date().toISOString(),
      reason: String(e?.message || e),
      lat: rLat,
      lng: rLng,
      cache: "miss"
    };
    saveCache(cacheKey, fallback);
    return fallback;
  }
}

/* ===== スコアリング（簡易てんくら風）===== */
function scoreFromOpenMeteo(data) {
  const result = {};
  const h = data?.hourly;
  if (!h?.time?.length) return makeDummy();

  // time: "YYYY-MM-DDTHH:MM"
  for (let i = 0; i < h.time.length; i++) {
    const iso = h.time[i];
    const [date, hhmm] = iso.split("T");
    if (!TIME_SLOTS.includes(hhmm)) continue;

    const prcp = num(h.precipitation?.[i]);     // mm
    const wspd = num(h.windspeed_10m?.[i]);      // m/s
    const gust = num(h.windgusts_10m?.[i]);      // m/s
    const wcode = num(h.weathercode?.[i]);       // weathercode

    const score = toABC({ prcp, wspd, gust, wcode });

    if (!result[date]) result[date] = {};
    result[date][hhmm] = score;
  }

  // 欠け対策：今日〜3日後 × TIME_SLOTS を必ず埋める
  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    if (!result[dateKey]) result[dateKey] = {};
    TIME_SLOTS.forEach((t, idx) => {
      const s = result[dateKey][t] ?? "C";
      result[dateKey][t] = s;
      result[dateKey][idx] = s; // 将来API差し替え用（indexキー保持）
    });
  }

  return result;
}

function toABC({ prcp, wspd, gust, wcode }) {
  const severe = isSevereCode(wcode);

  if (severe) return "C";
  if (gust >= 18 || wspd >= 12) return "C";
  if (prcp >= 2.0) return "C";

  if (gust >= 12 || wspd >= 8) return "B";
  if (prcp >= 0.5) return "B";

  return "A";
}

function isSevereCode(code) {
  if (!Number.isFinite(code)) return false;
  if (code >= 95) return true;                 // 雷雨
  if (code >= 71 && code <= 77) return true;   // 雪系
  if (code >= 65 && code <= 67) return true;   // 強めの雨
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
      const s = randomScore();
      result[dateKey][t] = s;
      result[dateKey][idx] = s;
    });
  }
  return result;
}
function randomScore() {
  const r = Math.random();
  if (r < 0.5) return "A";
  if (r < 0.8) return "B";
  return "C";
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
  } catch {}
}
