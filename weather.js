// weather.js (tenkura-like, precip-primary, elevation-adjust, v7)
//
// 追加方針（てんくら寄せ）
// - Open-Meteo に &elevation= を渡す（統計的ダウンスケーリング用）
// - さらに「山の標高」に合わせて temp/wind を自前補正して表示・判定に使う
//
// 注意：これは“近似”。てんくらのような山岳専用モデルそのものではない。

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ
const CACHE_PREFIX = "mount_weather_v7_"; // ★ v7
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

// ===== スコア判定（前回の “降水主軸・風/気温は補助” を維持） =====
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
function scoreWithComponents(level, metrics){
  const th = thresholdsByLevel(level);
  let s = baseScoreByPrecip(metrics.precipitation, th);
  s = applyWindSupport(s, metrics.windspeed, metrics.gust, th);
  s = applyTempSupport(s, metrics.temp, th);
  return { score: s, thresholds: th };
}

// ===== 標高補正（ここが今回の追加） =====
// 気温減率：6.5℃/1000m（標準大気の目安）
const LAPSE_C_PER_1000M = 6.5;

// 風補正：やりすぎ防止の控えめ補正（標高差が大きいと少し増やす）
// - 標高差 1000m で +15% 程度、最大 +30% で頭打ち
function windExposureFactor(deltaElevM){
  if (!Number.isFinite(deltaElevM)) return 1.0;
  const k = 1.0 + 0.15 * (deltaElevM / 1000);
  return clamp(k, 1.0, 1.30);
}

function adjustByElevation(raw, targetElevM, apiElevM){
  // raw: { precipitation, windspeed, gust, temp }
  if (!raw) return null;

  const tgt = toNumber(targetElevM);
  const api = toNumber(apiElevM);

  // 標高情報がない場合はそのまま
  if (tgt === null || api === null) return { ...raw, _elev: { target: tgt, api: api, delta: null } };

  const delta = tgt - api; // +なら山の方が高い
  const adj = { ...raw };

  // 気温：高いほど下がる（deltaが+なら tempを下げる）
  if (adj.temp !== null) {
    adj.temp = adj.temp - (LAPSE_C_PER_1000M * (delta / 1000));
  }

  // 風：高いほど露出が増える想定で“控えめに”上げる
  const f = windExposureFactor(delta);
  if (adj.windspeed !== null) adj.windspeed = adj.windspeed * f;
  if (adj.gust !== null)      adj.gust      = adj.gust * f;

  adj._elev = { target: tgt, api: api, delta };

  return adj;
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

  // ★ 標高を渡す（Open-Meteoの downscaling 用）
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

function buildFromHourly(name, lat, lng, level, hourly, targetElevM, apiElevM){
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

      const raw = pickAtHour(hourly, wantIso);
      if (!raw) {
        out[dk][slot] = null;
        details[dk][slot] = null;
        continue;
      }

      // ★ 山の標高に合わせて補正した値で判定＆表示
      const adj = adjustByElevation(raw, targetElevM, apiElevM);
      const judged = scoreWithComponents(level, adj);

      out[dk][slot] = judged.score ?? null;
      details[dk][slot] = {
        ...adj,
        _thresholds: judged.thresholds,
      };
    }
  }

  return { out, details };
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
function dummyWeather(name, lat, lng, level, elevationM, reason){
  const out = {};
  const details = {};
  const now = new Date();
  now.setHours(0,0,0,0);

  const seed = hashCode(`${name}_${lat}_${lng}_${level}_${elevationM}`);
  const rand = mulberry32(seed);

  // ダミーは過激にしない
  for (let d = 0; d < 4; d++){
    const dt = new Date(now.getTime());
    dt.setDate(dt.getDate() + d);
    const dk = dateKeyLocal(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const raw = {
        precipitation: clamp(rand() * 5.5, 0, 8),
        windspeed:     clamp(rand() * 14, 0, 22),
        gust:          clamp(rand() * 22, 0, 32),
        temp:          clamp((rand() * 18) - 2, -12, 22),
      };

      // api標高が不明なので、標高補正は“山標高だけ”で適当に微調整するより、ここではそのまま
      const judged = scoreWithComponents(level, raw);

      out[dk][slot] = judged.score ?? "B";
      details[dk][slot] = { ...raw, _thresholds: judged.thresholds, _elev: { target: elevationM ?? null, api: null, delta: null } };
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
      elevation: Number.isFinite(Number(elevationM)) ? Math.round(Number(elevationM)) : null
    }
  };
}

// ===== キャッシュ =====
function cacheKey(lat, lng, elevationM){
  const la = Number(lat).toFixed(3);
  const ln = Number(lng).toFixed(3);
  const el = Number.isFinite(Number(elevationM)) ? Math.round(Number(elevationM)) : "na";
  return `${CACHE_PREFIX}${la}_${ln}_${el}`;
}
function loadCache(lat, lng, elevationM){
  try{
    const key = cacheKey(lat, lng, elevationM);
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
function saveCache(lat, lng, elevationM, payload){
  try{
    const key = cacheKey(lat, lng, elevationM);
    localStorage.setItem(key, JSON.stringify(payload));
  }catch{}
}

// ===== 公開API =====
export async function generateWeatherScore(name, lat, lng, level="中級", elevationM=null){
  const cached = loadCache(lat, lng, elevationM);
  if (cached && cached.out && cached.details && cached.meta) {
    return { ...cached.out, _details: cached.details, _meta: cached.meta };
  }

  try{
    const { json, url } = await fetchOpenMeteo(lat, lng, elevationM);

    const hourly = json?.hourly;
    if (!hourly) throw new Error("Open-Meteo hourly missing");

    // Open-Meteoが返す elevation（APIが使った地表標高）
    const apiElev = toNumber(json?.elevation);

    const { out, details } = buildFromHourly(
      name, lat, lng, level,
      hourly,
      elevationM,
      apiElev
    );

    const meta = {
      source: "api",
      fetchedAt: isoNow(),
      lat, lng,
      url,
      elevation_target: Number.isFinite(Number(elevationM)) ? Math.round(Number(elevationM)) : null,
      elevation_api: apiElev
    };

    const payload = { out, details, meta, fetchedAt: meta.fetchedAt };
    saveCache(lat, lng, elevationM, payload);

    return { ...out, _details: details, _meta: meta };
  }catch(e){
    const reason = (e && e.message) ? e.message : "unknown error";
    const dummy = dummyWeather(name, lat, lng, level, elevationM, reason);

    const payload = { out: dummy.out, details: dummy.details, meta: dummy.meta, fetchedAt: dummy.meta.fetchedAt };
    saveCache(lat, lng, elevationM, payload);

    return { ...dummy.out, _details: dummy.details, _meta: dummy.meta };
  }
}
