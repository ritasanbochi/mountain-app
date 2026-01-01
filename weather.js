// weather.js (tenkura-like, precip-primary, elevation-adjust, mid+summit, v8)
//
// 追加方針（てんくら寄せ）
// - Open-Meteo に &elevation= を渡す（統計的ダウンスケーリング用）
// - 「山頂」と「中腹(50%)」の2段で temp/wind/gust を補正して表示
// - スコアは山頂（安全側）で判定
//
// index.html 側は generateWeatherScore(name, lat, lng, level, elevM) を呼ぶ前提。

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ
const CACHE_PREFIX = "mount_weather_v8_"; // ★ v8: 旧キャッシュ無効化
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// UI時間帯（index.htmlと合わせる）
const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pad2(n){ return String(n).padStart(2, "0"); }
function dateKeyLocal(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoNow(){ return new Date().toISOString(); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

// ===== スコア判定（降水主軸・風/気温は補助） =====
function thresholdsByLevel(level){
  const base = {
    rainA: 1.0, rainB: 4.0,
    windWarn: 16, windDanger: 22,
    gustWarn: 25, gustDanger: 33,
    tempWarn: -6, tempDanger: -12
  };
  if (level === "初級"){
    return {
      rainA: 0.8, rainB: 3.5,
      windWarn: 15, windDanger: 20,
      gustWarn: 23, gustDanger: 30,
      tempWarn: -4, tempDanger: -10
    };
  }
  if (level === "上級"){
    return {
      rainA: 1.2, rainB: 4.5,
      windWarn: 17, windDanger: 24,
      gustWarn: 27, gustDanger: 35,
      tempWarn: -7, tempDanger: -13
    };
  }
  return base;
}

function baseScoreByPrecip(p, th){
  if (p === null) return null;
  if (p <= th.rainA) return "A";
  if (p <= th.rainB) return "B";
  return "C";
}
function applyWindSupport(score, wind, gust, th){
  const danger = (wind !== null && wind >= th.windDanger) || (gust !== null && gust >= th.gustDanger);
  if (danger) return "C";
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
function scoreBySummit(level, summitMetrics){
  const th = thresholdsByLevel(level);
  let s = baseScoreByPrecip(summitMetrics.precipitation, th);
  s = applyWindSupport(s, summitMetrics.windspeed, summitMetrics.gust, th);
  s = applyTempSupport(s, summitMetrics.temp, th);
  return { score: s, thresholds: th };
}

// ===== 標高補正（山頂/中腹） =====
// 気温減率：6.5℃/1000m（標準大気の目安）
const LAPSE_C_PER_1000M = 6.5;

// 風補正：やりすぎ防止の控えめ補正（標高差が大きいと少し増やす）
// - 標高差 1000m で +15% 程度、最大 +30% で頭打ち
function windExposureFactor(deltaElevM){
  if (!Number.isFinite(deltaElevM)) return 1.0;
  const k = 1.0 + 0.15 * (deltaElevM / 1000);
  return clamp(k, 1.0, 1.30);
}

function adjustToElevation(raw, targetElevM, apiElevM){
  // raw: { precipitation, windspeed, gust, temp }
  const tgt = toNumber(targetElevM);
  const api = toNumber(apiElevM);

  const out = { ...raw };

  if (tgt === null || api === null) {
    out._elev = { target: tgt, api: api, delta: null };
    return out;
  }

  const delta = tgt - api; // +なら山の方が高い
  if (out.temp !== null) {
    out.temp = out.temp - (LAPSE_C_PER_1000M * (delta / 1000));
  }

  const f = windExposureFactor(delta);
  if (out.windspeed !== null) out.windspeed = out.windspeed * f;
  if (out.gust !== null)      out.gust      = out.gust * f;

  out._elev = { target: tgt, api: api, delta };
  return out;
}

function calcMidElevation(summitElevM, apiElevM){
  const s = toNumber(summitElevM);
  const api = toNumber(apiElevM);
  if (s === null) return null;
  if (api === null) return Math.round(s * 0.5);
  return Math.round(api + (s - api) * 0.5);
}

// ===== Open-Meteo取得 =====
async function fetchOpenMeteo(lat, lng, elevationM){
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: "precipitation,wind_speed_10m,wind_gusts_10m,temperature_2m",
    forecast_days: "4",
    timezone: TIMEZONE
  });

  // ★ 標高を渡す
  if (Number.isFinite(Number(elevationM))) {
    params.set("elevation", String(Math.round(Number(elevationM))));
  }

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

  return {
    precipitation: toNumber(hourly.precipitation?.[idx]),
    windspeed:     toNumber(hourly.wind_speed_10m?.[idx]),
    gust:          toNumber(hourly.wind_gusts_10m?.[idx]),
    temp:          toNumber(hourly.temperature_2m?.[idx]),
  };
}

function buildFromHourly(name, lat, lng, level, hourly, summitElevM, apiElevM){
  const out = {};
  const details = {};

  const midElevM = calcMidElevation(summitElevM, apiElevM);

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

      const raw = pickAtHour(hourly, wantIso);
      if (!raw) {
        out[dk][slot] = null;
        details[dk][slot] = null;
        continue;
      }

      // 山頂/中腹の2段を作る
      const summit = adjustToElevation(raw, summitElevM, apiElevM);
      const mid    = adjustToElevation(raw, midElevM,    apiElevM);

      // スコアは山頂で判定（安全側）
      const judged = scoreBySummit(level, summit);

      out[dk][slot] = judged.score ?? null;

      details[dk][slot] = {
        // 降水は共通（標高補正しない）
        precipitation: raw.precipitation,

        // 中腹
        windspeed_mid: mid.windspeed,
        gust_mid:      mid.gust,
        temp_mid:      mid.temp,

        // 山頂
        windspeed_summit: summit.windspeed,
        gust_summit:      summit.gust,
        temp_summit:      summit.temp,

        // 内部情報
        _thresholds: judged.thresholds,
        _elev: {
          api: toNumber(apiElevM),
          mid: toNumber(midElevM),
          summit: toNumber(summitElevM),
          delta_mid: mid?._elev?.delta ?? null,
          delta_summit: summit?._elev?.delta ?? null
        }
      };
    }
  }

  return { out, details, midElevM };
}

// ===== ダミー（フォールバック） =====
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
function dummyWeather(name, lat, lng, level, summitElevM, reason){
  const out = {};
  const details = {};
  const now = new Date();
  now.setHours(0,0,0,0);

  const seed = hashCode(`${name}_${lat}_${lng}_${level}_${summitElevM}`);
  const rand = mulberry32(seed);

  const summit = toNumber(summitElevM);
  const mid = summit !== null ? Math.round(summit * 0.5) : null;

  for (let d = 0; d < 4; d++){
    const dt = new Date(now.getTime());
    dt.setDate(dt.getDate() + d);
    const dk = dateKeyLocal(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const precipitation = clamp(rand() * 5.5, 0, 8);
      const windRaw = clamp(rand() * 14, 0, 22);
      const gustRaw = clamp(windRaw + rand()*10, 0, 36);
      const tempRaw = clamp((rand() * 18) - 2, -12, 22);

      // ダミーはapi標高が無いので、山頂/中腹の差分は簡易に気温だけ少し下げる程度
      const tempSummit = (summit !== null) ? (tempRaw - 5) : tempRaw;
      const tempMid    = (mid !== null) ? (tempRaw - 2.5) : tempRaw;

      const summitMetrics = { precipitation, windspeed: windRaw, gust: gustRaw, temp: tempSummit };
      const judged = scoreBySummit(level, summitMetrics);

      out[dk][slot] = judged.score ?? "B";
      details[dk][slot] = {
        precipitation,
        windspeed_mid: windRaw,
        gust_mid: gustRaw,
        temp_mid: tempMid,
        windspeed_summit: windRaw,
        gust_summit: gustRaw,
        temp_summit: tempSummit,
        _thresholds: judged.thresholds,
        _elev: { api: null, mid, summit, delta_mid: null, delta_summit: null }
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
      lat, lng,
      elevation_summit: summit
    }
  };
}

// ===== キャッシュ =====
function cacheKey(lat, lng, summitElevM){
  const la = Number(lat).toFixed(3);
  const ln = Number(lng).toFixed(3);
  const el = Number.isFinite(Number(summitElevM)) ? Math.round(Number(summitElevM)) : "na";
  return `${CACHE_PREFIX}${la}_${ln}_${el}`;
}
function loadCache(lat, lng, summitElevM){
  try{
    const key = cacheKey(lat, lng, summitElevM);
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
function saveCache(lat, lng, summitElevM, payload){
  try{
    const key = cacheKey(lat, lng, summitElevM);
    localStorage.setItem(key, JSON.stringify(payload));
  }catch{}
}

// ===== 公開API =====
export async function generateWeatherScore(name, lat, lng, level="中級", summitElevM=null){
  const cached = loadCache(lat, lng, summitElevM);
  if (cached && cached.out && cached.details && cached.meta) {
    return { ...cached.out, _details: cached.details, _meta: cached.meta };
  }

  try{
    const { json, url } = await fetchOpenMeteo(lat, lng, summitElevM);

    const hourly = json?.hourly;
    if (!hourly) throw new Error("Open-Meteo hourly missing");

    const apiElev = toNumber(json?.elevation);
    const { out, details, midElevM } = buildFromHourly(
      name, lat, lng, level, hourly, summitElevM, apiElev
    );

    const meta = {
      source: "api",
      fetchedAt: isoNow(),
      lat, lng,
      url,
      elevation_api: apiElev,
      elevation_summit: Number.isFinite(Number(summitElevM)) ? Math.round(Number(summitElevM)) : null,
      elevation_mid: Number.isFinite(Number(midElevM)) ? Math.round(Number(midElevM)) : null
    };

    const payload = { out, details, meta, fetchedAt: meta.fetchedAt };
    saveCache(lat, lng, summitElevM, payload);

    return { ...out, _details: details, _meta: meta };
  }catch(e){
    const reason = (e && e.message) ? e.message : "unknown error";
    const dummy = dummyWeather(name, lat, lng, level, summitElevM, reason);

    const payload = { out: dummy.out, details: dummy.details, meta: dummy.meta, fetchedAt: dummy.meta.fetchedAt };
    saveCache(lat, lng, summitElevM, payload);

    return { ...dummy.out, _details: dummy.details, _meta: dummy.meta };
  }
}
