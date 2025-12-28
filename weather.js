// weather.js
// Open-Meteo 実データ版（APIキー不要）＋ UI完全互換 + 根拠データ(details)付き
// - UIが使うフォーマット: result[dateKey][time] = "A|B|C"
// - 判別: result._meta.source === "api" | "dummy"
// - 根拠: result._details[dateKey][time] = { temp, precipitation, windspeed, gust, weathercode, score }

export const TIME_SLOTS = ["06:00","08:00","10:00","12:00","14:00","16:00"];

const CACHE_TTL_API_MS = 60 * 60 * 1000;   // API成功は 60分キャッシュ
const CACHE_TTL_DUMMY_MS = 2 * 60 * 1000;  // ダミーは 2分で捨てる（重要）

const scorePriority = { A:3, B:2, C:1 };

export async function generateWeatherScore(name, lat, lng) {
  const rLat = round(lat, 3);
  const rLng = round(lng, 3);
  const cacheKey = `wxscore:${rLat},${rLng}`;

  // キャッシュ読み込み（API or dummy両方）
  const cached = loadCache(cacheKey);
  if (cached) return cached;

  const url = buildOpenMeteoUrl(rLat, rLng);

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);

    const data = await res.json();
    const scored = scoreFromOpenMeteo(data);

    scored._meta = {
      source: "api",
      fetchedAt: new Date().toISOString(),
      lat: rLat,
      lng: rLng,
      url
    };

    // API成功は長めにキャッシュ
    saveCache(cacheKey, scored, CACHE_TTL_API_MS);
    return scored;
  } catch (e) {
    const fallback = makeDummy();
    fallback._meta = {
      source: "dummy",
      fetchedAt: new Date().toISOString(),
      lat: rLat,
      lng: rLng,
      url,
      reason: String(e?.message || e)
    };

    // ダミーは短命キャッシュ（次回すぐ再挑戦できるように）
    saveCache(cacheKey, fallback, CACHE_TTL_DUMMY_MS);
    return fallback;
  }
}

/* ===================== Open-Meteo ===================== */

function buildOpenMeteoUrl(lat, lng){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lng);
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
  return url.toString();
}

function scoreFromOpenMeteo(data){
  const result = {};
  result._details = {};

  const h = data?.hourly;
  if (!h?.time?.length) return makeDummy();

  for (let i = 0; i < h.time.length; i++) {
    const iso = h.time[i]; // "YYYY-MM-DDTHH:MM"
    const [date, hhmm] = String(iso).split("T");
    if (!TIME_SLOTS.includes(hhmm)) continue;

    const temp = num(h.temperature_2m?.[i]);
    const prcp = num(h.precipitation?.[i]);    // mm
    const wspd = num(h.windspeed_10m?.[i]);     // m/s
    const gust = num(h.windgusts_10m?.[i]);     // m/s
    const wcode = num(h.weathercode?.[i]);

    const score = toABC({ prcp, wspd, gust, wcode });

    if (!result[date]) result[date] = {};
    if (!result._details[date]) result._details[date] = {};

    result[date][hhmm] = score;
    result._details[date][hhmm] = { temp, precipitation: prcp, windspeed: wspd, gust, weathercode: wcode, score };
  }

  // 欠け対策：今日〜3日後 × TIME_SLOTS を必ず埋める（UI安定）
  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    if (!result[dateKey]) result[dateKey] = {};
    if (!result._details[dateKey]) result._details[dateKey] = {};

    TIME_SLOTS.forEach((t, idx) => {
      const s = result[dateKey][t] ?? "C";
      result[dateKey][t] = s;
      result[dateKey][idx] = s; // 将来用 indexキーも保持

      // detailsが無い枠は空オブジェクト（表示は - になる）
      if (!result._details[dateKey][t]) result._details[dateKey][t] = null;
    });
  }

  return result;
}

/* ===================== Scoring（簡易てんくら風）===================== */
/**
 * 判定基準（目安）
 * C: 雷雨/雪系コード、または 突風>=18m/s or 風速>=12m/s or 降水>=2.0mm
 * B: 突風>=12m/s or 風速>=8m/s or 降水>=0.5mm
 * A: それ以外
 */
function toABC({ prcp, wspd, gust, wcode }){
  const severe = isSevereCode(wcode);

  if (severe) return "C";
  if (gust >= 18 || wspd >= 12) return "C";
  if (prcp >= 2.0) return "C";

  if (gust >= 12 || wspd >= 8) return "B";
  if (prcp >= 0.5) return "B";

  return "A";
}

function isSevereCode(code){
  if (!Number.isFinite(code)) return false;
  if (code >= 95) return true;               // 雷雨
  if (code >= 71 && code <= 77) return true; // 雪系
  if (code >= 65 && code <= 67) return true; // 強めの雨
  return false;
}

/* ===================== Dummy ===================== */

function makeDummy(){
  const result = {};
  result._details = {};

  for (let d = 0; d <= 3; d++) {
    const dateKey = getDateKey(d);
    result[dateKey] = {};
    result._details[dateKey] = {};

    TIME_SLOTS.forEach((t, idx) => {
      const s = randomScore();
      result[dateKey][t] = s;
      result[dateKey][idx] = s;
      result._details[dateKey][t] = null; // ダミーは根拠無し
    });
  }
  return result;
}

function randomScore(){
  const r = Math.random();
  if (r < 0.5) return "A";
  if (r < 0.8) return "B";
  return "C";
}

/* ===================== Cache ===================== */

function loadCache(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const obj = JSON.parse(raw);
    if(!obj?.ts || !obj?.ttl || !obj?.data) return null;

    if(Date.now() - obj.ts > obj.ttl) return null;
    return obj.data;
  }catch{
    return null;
  }
}

function saveCache(key, data, ttl){
  try{
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl, data }));
  }catch{}
}

/* ===================== utils ===================== */
function getDateKey(add){
  const d = new Date();
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}
function num(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function round(v, digits){
  const p = 10 ** digits;
  return Math.round(Number(v) * p) / p;
}
