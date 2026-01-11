// weather.js
// Open-Meteo forecast -> 独自スコア (A/B/C)
// ✅ localStorage は使わず、セッション内メモリキャッシュ（TTL=1時間）
// 429対策: 429/5xx は指数バックオフでリトライ

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// セッション内キャッシュ: key -> { savedAt, data }
const MEM_CACHE = new Map();

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
  return `${la},${lo}`;
}

function loadCache(lat, lng) {
  const k = cacheKey(lat, lng);
  const obj = MEM_CACHE.get(k);
  if (!obj || !obj.savedAt || !obj.data) return null;
  if ((Date.now() - obj.savedAt) > CACHE_TTL_MS) {
    MEM_CACHE.delete(k);
    return null;
  }
  return obj.data;
}

function saveCache(lat, lng, data) {
  MEM_CACHE.set(cacheKey(lat, lng), { savedAt: Date.now(), data });
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
 * 基準値算出（設計書 §7, §8 準拠）
 * 難易度・標高・季節による補正を適用
 */
function baselineBySeason(level, elev, month) {
  const winter = (month === 12 || month === 1 || month === 2);
  const high = (elev ?? 0) >= 2500;

  // 基本基準値
  let windBase = 10;  // m/s
  let gustBase = 15;  // m/s
  let tempBase = 5;   // ℃

  // 標高補正 (§7.2: >= 2500m は厳しめ)
  if (high) {
    windBase = 8;   // より低い値 = 厳しい
    gustBase = 12;
    tempBase = 0;
  }

  // 難易度補正 (§7.1: 上級は風・突風基準を厳しく)
  if (level === "上級") {
    windBase -= 2;  // 基準を下げる = 厳しくする
    gustBase -= 3;
  }

  // 季節補正 (§8: 冬は気温基準を厳しく)
  if (winter) {
    tempBase = high ? -10 : -5;  // より低い値
  }

  return { windBase, gustBase, tempBase };
}

/**
 * スコア算出ロジック（設計書 §5, §6 準拠）
 * 
 * §5: 降水量による一次判定（絶対評価）
 *   >= 1.0mm/h → C（即中止検討）
 *   0.3～0.9mm/h → B（注意）
 *   < 0.3mm/h → 次の評価へ
 * 
 * §6: 風・突風・気温の補助評価（ペナルティ方式）
 *   各要素が基準値を大きく超過/低下 → ペナルティ+1
 *   ペナルティ合計: 0～1 → A、2以上 → B
 */
function scoreFromRule(precip, wind, gust, temp, level, elev, dateKey) {
  // §5: 降水量による一次判定（絶対評価）
  if (precip == null) return null;

  if (precip >= 1.0) return "C";  // 即C判定、他要素は評価しない
  if (precip >= 0.3) return "B";  // B判定確定

  // 降水量 < 0.3mm/h の場合、§6: 補助評価へ進む
  const month = Number(String(dateKey).slice(5, 7));
  const { windBase, gustBase, tempBase } = baselineBySeason(level, elev, month);

  // §6.2: ペナルティ付与条件
  let penalty = 0;

  // 風速が基準値より大きく超過
  if (wind != null && wind > windBase + 5) {
    penalty += 1;
  }

  // 突風が基準値より大きく超過
  if (gust != null && gust > gustBase + 8) {
    penalty += 1;
  }

  // 気温が基準値より大きく低下
  if (temp != null && temp < tempBase - 10) {
    penalty += 1;
  }

  // §6.3: 判定
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
