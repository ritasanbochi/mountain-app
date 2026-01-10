// weather.js
// Open-Meteo forecast -> 独自スコア (A/B/C)
// localStorage キャッシュあり（1時間）
// 429対策: 429/5xx は指数バックオフでリトライ

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

const CACHE_PREFIX = "wx_cache_v6:";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// UI時間帯（index.htmlと合わせる）
const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function cacheKey(lat, lng) {
  const la = Number(lat).toFixed(5);
  const lo = Number(lng).toFixed(5);
  return `${CACHE_PREFIX}${la},${lo}`;
}

function loadCache(lat, lng) {
  try {
    const raw = localStorage.getItem(cacheKey(lat, lng));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.savedAt || !obj.data) return null;
    if ((Date.now() - obj.savedAt) > CACHE_TTL_MS) return null;
    return obj.data;
  } catch {
    return null;
  }
}

function saveCache(lat, lng, data) {
  try {
    localStorage.setItem(cacheKey(lat, lng), JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // QuotaExceeded等は無視（表示自体は継続）
  }
}

async function fetchOpenMeteo(lat, lng){
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "precipitation,wind_speed_10m,wind_gusts_10m,temperature_2m",
    forecast_days: "4",
    timezone: TIMEZONE
  });

  const url = `${OPEN_METEO_ENDPOINT}?${params.toString()}`;

  // 429対策：軽いリトライ（指数バックオフ）
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++){
    const res = await fetch(url);
    if (res.ok){
      const json = await res.json();
      return { json, url };
    }

    const status = res.status;

    // 429 / 5xx はリトライ対象
    if (status === 429 || (status >= 500 && status <= 599)){
      const base = 700 * Math.pow(2, attempt - 1); // 0.7s, 1.4s, 2.8s, ...
      const jitter = Math.floor(Math.random() * 250);
      const wait = Math.min(12000, base + jitter);
      await sleep(wait);
      continue;
    }

    throw new Error(`Open-Meteo HTTP ${status}`);
  }

  throw new Error("Open-Meteo retry exhausted (429/5xx)");
}

function pickAtHour(hourly, wantIso) {
  const times = hourly?.time;
  if (!Array.isArray(times)) return null;
  const i = times.indexOf(wantIso);
  if (i < 0) return null;

  const p = hourly?.precipitation?.[i];
  const w = hourly?.wind_speed_10m?.[i];
  const g = hourly?.wind_gusts_10m?.[i];
  const t = hourly?.temperature_2m?.[i];

  return {
    precip: toNumber(p),
    wind: toNumber(w),
    gust: toNumber(g),
    temp: toNumber(t)
  };
}

function hourIso(dateKey, timeHHMM) {
  // dateKey: YYYY-MM-DD, timeHHMM: "06:00"
  return `${dateKey}T${timeHHMM}`;
}

/**
 * baseline（雑）：あなたのロジックがもっと複雑なら、ここを既存のまま置き換えてOK
 */
function baselineBySeason(level, elev, month) {
  // 雑な目安（既存の基準があればそちら優先でOK）
  const winter = (month === 12 || month === 1 || month === 2);
  const high = (elev ?? 0) >= 2500;

  let windBase = high ? 12 : 9;
  let gustBase = high ? 18 : 14;
  let tempBase = winter ? (high ? -12 : -6) : (high ? 2 : 8);

  if (level === "上級") {
    windBase += 1;
    gustBase += 2;
  }

  return { windBase, gustBase, tempBase };
}

function scoreFromRule(precip, wind, gust, temp, level, elev, dateKey) {
  // 降水：絶対評価（主軸）
  if (precip == null) return null;

  if (precip >= 1.0) return "C";
  if (precip >= 0.3) return "B";

  // 風・突風・気温：補助（baselineとの差）
  const month = Number(String(dateKey).slice(5,7));
  const { windBase, gustBase, tempBase } = baselineBySeason(level, elev, month);

  let penalty = 0;
  if (wind != null && wind >= windBase + 4) penalty += 1;
  if (gust != null && gust >= gustBase + 6) penalty += 1;
  if (temp != null && temp <= tempBase - 8) penalty += 1;

  if (penalty >= 2) return "B";
  return "A";
}

/**
 * 返却フォーマット:
 *  weather[dateKey][timeSlot] = "A"|"B"|"C"
 *  weather.__detail[dateKey][timeSlot] = {precip, wind, gust, temp}
 */
export async function generateWeatherScore(name, lat, lng, level="中級", elev=null) {
  // cache
  const cached = loadCache(lat, lng);
  if (cached) return cached;

  const { json } = await fetchOpenMeteo(lat, lng);
  const hourly = json?.hourly;
  const weather = {};
  const detail = {};

  for (let d=0; d<=3; d++){
    const dateKey = (() => {
      const base = new Date();
      base.setHours(0,0,0,0);
      base.setDate(base.getDate() + d);
      const y = base.getFullYear();
      const m = String(base.getMonth()+1).padStart(2,"0");
      const dd = String(base.getDate()).padStart(2,"0");
      return `${y}-${m}-${dd}`;
    })();

    weather[dateKey] = {};
    detail[dateKey] = {};

    for (const t of TIME_SLOTS){
      const iso = hourIso(dateKey, t);
      const v = pickAtHour(hourly, iso);
      if (!v){
        weather[dateKey][t] = null;
        continue;
      }
      const s = scoreFromRule(v.precip, v.wind, v.gust, v.temp, level, elev, dateKey);
      weather[dateKey][t] = s;
      detail[dateKey][t] = v;
    }
  }

  weather.__detail = detail;

  // save
  saveCache(lat, lng, weather);
  return weather;
}
