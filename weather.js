// weather.js (tenkura-like, precip-primary, v6)
//
// 方針：
// - スコアは「降水（天気）」を主軸に決める
// - 風・突風・気温は “危険域/極端” のときだけ補助的に格下げ
// - てんくら寄せ：Cを出しにくくする（＝危険域は明確にC、それ以外はB止まりが多い）
//
// v6: 風の評価を「少しだけ」甘く（平均風が強い山がある前提）
//     + キャッシュprefix更新

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ（localStorage）
const CACHE_PREFIX = "mount_weather_v6_"; // ★ v6: 旧キャッシュ無効化
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// UIが使う時間帯（index.htmlと合わせる）
const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pad2(n){ return String(n).padStart(2, "0"); }
function dateKeyLocal(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoNow(){ return new Date().toISOString(); }

const pr = { A: 3, B: 2, C: 1 };
function worse(a, b){
  if (!a) return b;
  if (!b) return a;
  return pr[a] <= pr[b] ? a : b;
}

/**
 * てんくら寄せ（降水主軸）
 *
 * ▼降水(mm/h)で基本スコア
 *   A: <= 1.0
 *   B: <= 4.0
 *   C: > 4.0
 *
 * ▼風(m/s)・突風(m/s)で補助（危険域は明確に）
 *   風 or 突風が危険域 → C
 *   注意域 → 最大B（AならBに落とす程度）
 *
 * ▼気温(℃)で補助（極端な寒さだけ）
 */
function thresholdsByLevel(level){
  // ★ 風を少し甘く（基準）
  const base = {
    // precip
    rainA: 1.0, rainB: 4.0,

    // wind/gust (support)  ← v6で緩和
    windWarn: 16, windDanger: 22,
    gustWarn: 25, gustDanger: 33,

    // temp (support)
    tempWarn: -6, tempDanger: -12
  };

  if (level === "初級"){
    // 初級も同方向で緩和（ただし基準よりは少し厳しめ）
    return {
      rainA: 0.8, rainB: 3.5,
      windWarn: 15, windDanger: 20,
      gustWarn: 23, gustDanger: 30,
      tempWarn: -4, tempDanger: -10
    };
  }
  if (level === "上級"){
    // 上級はさらに少し緩め
    return {
      rainA: 1.2, rainB: 4.5,
      windWarn: 17, windDanger: 24,
      gustWarn: 27, gustDanger: 35,
      tempWarn: -7, tempDanger: -13
    };
  }
  return base; // 中級
}

function baseScoreByPrecip(p, th){
  if (p === null) return null;
  if (p <= th.rainA) return "A";
  if (p <= th.rainB) return "B";
  return "C";
}

function applyWindSupport(score, wind, gust, th){
  // 危険域ならC
  const danger = (wind !== null && wind >= th.windDanger) || (gust !== null && gust >= th.gustDanger);
  if (danger) return "C";

  // 注意域なら最大B（A→Bに落とす）
  const warn = (wind !== null && wind >= th.windWarn) || (gust !== null && gust >= th.gustWarn);
  if (warn && score === "A") return "B";

  return score;
}

function applyTempSupport(score, temp, th){
  if (temp === null) return score;

  if (temp <= th.tempDanger) return "C";
  if (temp <= th.tempWarn && score === "A") return "B";

  return score;
}

function scoreWithComponents(level, metrics){
  const th = thresholdsByLevel(level);

  const p = metrics.precipitation;
  const w = metrics.windspeed;
  const g = metrics.gust;
  const t = metrics.temp;

  let s = baseScoreByPrecip(p, th);
  s = applyWindSupport(s, w, g, th);
  s = applyTempSupport(s, t, th);

  return {
    score: s,
    thresholds: th,
    components: {
      baseByPrecip: baseScoreByPrecip(p, th),
      windApplied: ((w !== null && w >= th.windWarn) || (g !== null && g >= th.gustWarn)) ? true : false,
      tempApplied: (t !== null && t <= th.tempWarn) ? true : false
    }
  };
}

/** ===== Open-Meteo 取得 ===== */
async function fetchOpenMeteo(lat, lng){
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "precipitation,wind_speed_10m,wind_gusts_10m,temperature_2m",
    forecast_days: "4",
    timezone: TIMEZONE
  });
  const url = `${OPEN_METEO_ENDPOINT}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  const json = await res.json();
  return { json, url };
}

function pickAtHour(hourly, wantIso){
  const times = hourly?.time;
  if (!Array.isArray(times)) return null;
  const idx = times.indexOf(wantIso);
  if (idx < 0) return null;

  const p = toNumber(hourly.precipitation?.[idx]);
  const w = toNumber(hourly.wind_speed_10m?.[idx]);
  const g = toNumber(hourly.wind_gusts_10m?.[idx]);
  const t = toNumber(hourly.temperature_2m?.[idx]);

  return { precipitation: p, windspeed: w, gust: g, temp: t };
}

function buildFromHourly(name, lat, lng, level, hourly){
  const out = {};
  const details = {};

  for (let d = 0; d < 4; d++){
    const dt = new Date();
    dt.setHours(0,0,0,0);
    dt.setDate(dt.getDate() + d);
    const dk = dateKeyLocal(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const hour = slot.slice(0,2);
      const wantIso = `${dk}T${hour}:00`;

      const m = pickAtHour(hourly, wantIso);
      if (!m) {
        out[dk][slot] = null;
        details[dk][slot] = null;
        continue;
      }

      const judged = scoreWithComponents(level, m);
      out[dk][slot] = judged.score ?? null;
      details[dk][slot] = {
        ...m,
        _components: judged.components,
        _thresholds: judged.thresholds
      };
    }
  }

  return { out, details };
}

/** ===== ダミー（フォールバック） ===== */
function hashCode(str){
  let h = 0;
  for (let i=0; i<str.length; i++){
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}
function mulberry32(a){
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
function dummyWeather(name, lat, lng, level, reason){
  const out = {};
  const details = {};
  const now = new Date();
  now.setHours(0,0,0,0);

  const seed = hashCode(`${name}_${lat}_${lng}_${level}`);
  const rand = mulberry32(seed);

  for (let d = 0; d < 4; d++){
    const dt = new Date(now.getTime());
    dt.setDate(dt.getDate() + d);
    const dk = dateKeyLocal(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const precipitation = clamp(rand() * 5.5, 0, 8);
      const windspeed     = clamp(rand() * 16, 0, 24);
      const gust          = clamp(windspeed + rand()*10, 0, 36);
      const temp          = clamp((rand() * 20) - 3, -15, 25);

      const m = { precipitation, windspeed, gust, temp };
      const judged = scoreWithComponents(level, m);

      out[dk][slot] = judged.score ?? "B";
      details[dk][slot] = {
        ...m,
        _components: judged.components,
        _thresholds: judged.thresholds
      };
    }
  }

  return {
    out,
    details,
    meta: {
      source: "dummy",
      fetchedAt: isoNow(),
      reason: reason || "API取得失敗",
      lat, lng
    }
  };
}

/** ===== キャッシュ ===== */
function cacheKey(lat, lng){
  const la = Number(lat).toFixed(3);
  const ln = Number(lng).toFixed(3);
  return `${CACHE_PREFIX}${la}_${ln}`;
}
function loadCache(lat, lng){
  try{
    const key = cacheKey(lat, lng);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || !obj.fetchedAt) return null;

    const t = new Date(obj.fetchedAt).getTime();
    if (!Number.isFinite(t)) return null;
    if (Date.now() - t > CACHE_TTL_MS) return null;

    return obj;
  }catch{
    return null;
  }
}
function saveCache(lat, lng, payload){
  try{
    const key = cacheKey(lat, lng);
    localStorage.setItem(key, JSON.stringify(payload));
  }catch{
    // storage制限は無視
  }
}

/** ===== 公開API ===== */
export async function generateWeatherScore(name, lat, lng, level="中級"){
  const cached = loadCache(lat, lng);
  if (cached && cached.out && cached.details && cached.meta) {
    return {
      ...cached.out,
      _details: cached.details,
      _meta: cached.meta
    };
  }

  try{
    const { json, url } = await fetchOpenMeteo(lat, lng);
    const hourly = json?.hourly;
    if (!hourly) throw new Error("Open-Meteo hourly missing");

    const { out, details } = buildFromHourly(name, lat, lng, level, hourly);

    const meta = {
      source: "api",
      fetchedAt: isoNow(),
      lat, lng,
      url
    };

    const payload = { out, details, meta, fetchedAt: meta.fetchedAt };
    saveCache(lat, lng, payload);

    return {
      ...out,
      _details: details,
      _meta: meta
    };
  }catch(e){
    const reason = (e && e.message) ? e.message : "unknown error";
    const dummy = dummyWeather(name, lat, lng, level, reason);

    const payload = { out: dummy.out, details: dummy.details, meta: dummy.meta, fetchedAt: dummy.meta.fetchedAt };
    saveCache(lat, lng, payload);

    return {
      ...dummy.out,
      _details: dummy.details,
      _meta: dummy.meta
    };
  }
}
