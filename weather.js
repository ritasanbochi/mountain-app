// weather.js v12
// v11のロジック維持 + Open-Meteoキャッシュを「簡易LRU(件数上限)」にしてQuota超過を回避

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

export const TIME_SLOTS = ["06:00","08:00","10:00","12:00","14:00","16:00"];

const LAPSE_C_PER_1000M = 6.5;
function windExposureFactor(deltaElevM){
  if (!Number.isFinite(deltaElevM)) return 1.0;
  const k = 1.0 + Math.min(0.35, Math.max(-0.2, deltaElevM / 2000 * 0.25));
  return k;
}

function toNumber(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pad2(n){ return String(n).padStart(2,"0"); }
function dateKeyLocal(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function nowIso(){ return new Date().toISOString(); }
function round1(x){
  const n = toNumber(x);
  if (n === null) return null;
  return Math.round(n * 10) / 10;
}

function regionFromLatLng(lat, lng){
  if (lat >= 41) return "hokkaido";
  if (lat >= 38.5) return "tohoku";
  if (lat >= 35.5) return "kanto";
  if (lat >= 34) return "chubu_kinki";
  return "kyushu";
}
function bandFromElev(elevM){
  const e = toNumber(elevM);
  if (e === null) return "mid";
  if (e >= 2500) return "high";
  if (e >= 1500) return "mid";
  return "low";
}

const BASELINE = {
  hokkaido: {
    low:  { wind:[6,6,6,6,6,6,6,6,6,6,6,6], temp:[-6,-6,-2,3,8,12,16,17,12,6,0,-4] },
    mid:  { wind:[8,8,8,8,8,8,8,8,8,8,8,8], temp:[-12,-12,-7,-1,4,8,12,13,8,2,-4,-9] },
    high: { wind:[10,10,10,10,10,10,10,10,10,10,10,10], temp:[-16,-16,-12,-7,-2,2,6,7,2,-4,-10,-14] }
  },
  tohoku: {
    low:  { wind:[5,5,5,5,5,5,5,5,5,5,5,5], temp:[-3,-2,2,7,12,16,20,21,17,11,5,0] },
    mid:  { wind:[7,7,7,7,7,7,7,7,7,7,7,7], temp:[-8,-7,-3,2,7,11,15,16,12,6,0,-4] },
    high: { wind:[9,9,9,9,9,9,9,9,9,9,9,9], temp:[-12,-12,-8,-3,2,6,10,11,7,1,-5,-9] }
  },
  kanto: {
    low:  { wind:[5,5,5,5,5,5,5,5,5,5,5,5], temp:[1,2,6,11,16,20,24,25,21,15,9,4] },
    mid:  { wind:[7,7,7,7,7,7,7,7,7,7,7,7], temp:[-4,-3,1,6,11,15,19,20,16,10,4,-1] },
    high: { wind:[9,9,9,9,9,9,9,9,9,9,9,9], temp:[-8,-8,-4,1,6,10,14,15,11,5,-1,-5] }
  },
  chubu_kinki: {
    low:  { wind:[5,5,5,5,5,5,5,5,5,5,5,5], temp:[3,4,7,12,17,21,25,26,22,16,10,6] },
    mid:  { wind:[7,7,7,7,7,7,7,7,7,7,7,7], temp:[-2,-1,2,7,12,16,20,21,17,11,5,1] },
    high: { wind:[9,9,9,9,9,9,9,9,9,9,9,9], temp:[-6,-5,-2,3,8,12,16,17,13,7,1,-3] }
  },
  kyushu: {
    low:  { wind:[5,5,5,5,5,5,5,5,5,5,5,5], temp:[6,7,10,14,18,22,26,27,24,19,14,9] },
    mid:  { wind:[7,7,7,7,7,7,7,7,7,7,7,7], temp:[1,2,5,9,13,17,21,22,19,14,9,4] },
    high: { wind:[9,9,9,9,9,9,9,9,9,9,9,9], temp:[-3,-2,1,5,9,13,17,18,15,10,5,0] }
  }
};

function baselineAtElevation(lat, lng, elevM, month){
  const reg = regionFromLatLng(lat, lng);
  const band = bandFromElev(elevM);
  const m = Math.min(12, Math.max(1, Number(month)||1)) - 1;
  const b = BASELINE?.[reg]?.[band];
  if (!b) return null;
  return { wind: toNumber(b.wind?.[m]), temp: toNumber(b.temp?.[m]) };
}

function scoreFromPrecip(p){
  const v = toNumber(p);
  if (v === null) return "B";
  if (v >= 2.0) return "C";
  if (v >= 0.8) return "B";
  return "A";
}
function penaltyFromWind(w, baselineWind){
  const v = toNumber(w);
  const b = toNumber(baselineWind);
  if (v === null || b === null) return 0;
  const diff = v - b;
  if (diff >= 8) return 2;
  if (diff >= 4) return 1;
  return 0;
}
function penaltyFromGust(g){
  const v = toNumber(g);
  if (v === null) return 0;
  if (v >= 25) return 2;
  if (v >= 18) return 1;
  return 0;
}
function penaltyFromTemp(t, baselineTemp){
  const v = toNumber(t);
  const b = toNumber(baselineTemp);
  if (v === null || b === null) return 0;
  const diff = b - v;
  if (diff >= 10) return 2;
  if (diff >= 6) return 1;
  return 0;
}
function finalScore(baseScore, totalPenalty){
  if (baseScore === "C") return "C";
  if (totalPenalty >= 3) return "C";
  if (totalPenalty >= 1) return "B";
  return baseScore;
}

function detailPack(rawMid, rawSummit, baseMid, baseSummit, src){
  return {
    precipitation: round1(rawSummit?.precipitation ?? rawMid?.precipitation),
    windspeed_mid: round1(rawMid?.windspeed),
    windspeed_summit: round1(rawSummit?.windspeed),
    gust_mid: round1(rawMid?.gust),
    gust_summit: round1(rawSummit?.gust),
    temp_mid: round1(rawMid?.temp),
    temp_summit: round1(rawSummit?.temp),
    baseline_wind_mid: round1(baseMid?.wind),
    baseline_wind_summit: round1(baseSummit?.wind),
    baseline_temp_mid: round1(baseMid?.temp),
    baseline_temp_summit: round1(baseSummit?.temp),
    source: src
  };
}

function adjustToElevation(raw, targetElevM, apiElevM){
  const tgt = toNumber(targetElevM);
  const api = toNumber(apiElevM);
  const out = { ...raw };
  if (tgt === null || api === null) return out;

  const delta = tgt - api;
  if (out.temp !== null) out.temp = out.temp - (LAPSE_C_PER_1000M * (delta / 1000));
  const f = windExposureFactor(delta);
  if (out.windspeed !== null) out.windspeed = out.windspeed * f;
  if (out.gust !== null)      out.gust      = out.gust * f;
  return out;
}
function calcMidElevation(summitElevM, apiElevM){
  const s = toNumber(summitElevM);
  const api = toNumber(apiElevM);
  if (s === null) return null;
  if (api === null) return Math.round(s * 0.5);
  return Math.round(api + (s - api) * 0.5);
}

/* ========= Open-Meteo cache (LRU-ish) ========= */
const OM_CACHE_PREFIX = "openmeteo_forecast_v2";
const OM_CACHE_INDEX  = "openmeteo_forecast_index_v2";
const OM_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const OM_ROUND = 3;
const OM_MAX_ENTRIES = 120; // 上限（Quota対策）

function omKey(lat, lng){
  const r = (v) => Number(v).toFixed(OM_ROUND);
  return `${OM_CACHE_PREFIX}:${r(lat)},${r(lng)}:${TIMEZONE}`;
}
function omLoad(key){
  try{
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.ts || !obj?.json) return null;
    if (Date.now() - obj.ts > OM_CACHE_TTL_MS) return null;

    // touch index
    touchIndex(key, obj.ts);
    return obj;
  }catch{
    return null;
  }
}
function readIndex(){
  try{
    const raw = localStorage.getItem(OM_CACHE_INDEX);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}
function writeIndex(arr){
  try{ localStorage.setItem(OM_CACHE_INDEX, JSON.stringify(arr)); }catch{}
}
function touchIndex(key, ts){
  const idx = readIndex();
  const next = idx.filter(x => x?.key !== key);
  next.unshift({ key, ts: ts || Date.now() });
  writeIndex(next.slice(0, OM_MAX_ENTRIES));
}
function evictIfNeeded(){
  const idx = readIndex();
  if (idx.length <= OM_MAX_ENTRIES) return;

  const toRemove = idx.slice(OM_MAX_ENTRIES);
  for (const it of toRemove){
    try{ localStorage.removeItem(it.key); }catch{}
  }
  writeIndex(idx.slice(0, OM_MAX_ENTRIES));
}

function omSave(key, json, url){
  const payload = {
    ts: Date.now(),
    fetchedAt: new Date().toISOString(),
    url,
    json
  };

  try{
    localStorage.setItem(key, JSON.stringify(payload));
    touchIndex(key, payload.ts);
    evictIfNeeded();
    return;
  }catch(e){
    // まず古いのを少し削って再トライ
    try{
      const idx = readIndex();
      const removeCount = Math.min(20, idx.length);
      for (let i = idx.length - 1; i >= Math.max(0, idx.length - removeCount); i--){
        try{ localStorage.removeItem(idx[i].key); }catch{}
      }
      writeIndex(idx.slice(0, Math.max(0, idx.length - removeCount)));
    }catch{}

    try{
      localStorage.setItem(key, JSON.stringify(payload));
      touchIndex(key, payload.ts);
      evictIfNeeded();
    }catch{
      // それでも無理なら諦める（キャッシュ無しで動く）
    }
  }
}

function sleepMs(ms){ return new Promise(r => setTimeout(r, ms)); }

async function fetchWithBackoff(url, maxRetries = 6){
  let attempt = 0;
  while (true){
    const res = await fetch(url);
    if (res.ok) return res;

    const retryable = (res.status === 429) || (res.status >= 500 && res.status <= 599);
    attempt++;
    if (!retryable || attempt > maxRetries){
      throw new Error(`Open-Meteo HTTP ${res.status}`);
    }

    const ra = res.headers.get("Retry-After");
    let waitMs = 0;
    if (ra && Number.isFinite(Number(ra))){
      waitMs = Math.max(500, Number(ra) * 1000);
    }else{
      waitMs = Math.min(15000, 800 * Math.pow(2, attempt - 1));
    }
    await sleepMs(waitMs);
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

  const key = omKey(lat, lng);
  const cached = omLoad(key);
  if (cached){
    return { json: cached.json, url: cached.url || "CACHE" };
  }

  const res = await fetchWithBackoff(url);
  const json = await res.json();
  omSave(key, json, url);
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

function monthFromDateKey(dateKey){
  const m = Number(String(dateKey).slice(5,7));
  return Number.isFinite(m) ? m : (new Date().getMonth()+1);
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
    const month = monthFromDateKey(dk);

    const baselineSummit = (Number.isFinite(Number(summitElevM)))
      ? baselineAtElevation(lat, lng, Number(summitElevM), month)
      : null;

    const baselineMid = (Number.isFinite(Number(midElevM)))
      ? baselineAtElevation(lat, lng, Number(midElevM), month)
      : null;

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const hour = slot.slice(0,2);
      const wantIso = `${dk}T${hour}:00`;

      const raw = pickAtHour(hourly, wantIso) || { precipitation:null, windspeed:null, gust:null, temp:null };
      const rawSummit = adjustToElevation(raw, summitElevM, apiElevM);
      const rawMid = adjustToElevation(raw, midElevM, apiElevM);

      const baseScore = scoreFromPrecip(rawSummit.precipitation);

      const pWind = Math.max(
        penaltyFromWind(rawSummit.windspeed, baselineSummit?.wind),
        penaltyFromWind(rawMid.windspeed, baselineMid?.wind)
      );
      const pGust = Math.max(
        penaltyFromGust(rawSummit.gust),
        penaltyFromGust(rawMid.gust)
      );
      const pTemp = Math.max(
        penaltyFromTemp(rawSummit.temp, baselineSummit?.temp),
        penaltyFromTemp(rawMid.temp, baselineMid?.temp)
      );
      const totalPenalty = (pWind + pGust + pTemp);
      const score = finalScore(baseScore, totalPenalty);

      out[dk][slot] = score;
      details[dk][slot] = detailPack(rawMid, rawSummit, baselineMid, baselineSummit, "API");
    }
  }

  out._meta = {
    fetchedAt: nowIso(),
    source: "API",
    apiElev: toNumber(apiElevM),
    summitElev: toNumber(summitElevM),
    midElev: toNumber(midElevM)
  };
  out._details = details;
  return out;
}

function dummyHourly(){
  const dt = new Date();
  dt.setHours(0,0,0,0);
  const times = [];
  const precipitation = [];
  const wind_speed_10m = [];
  const wind_gusts_10m = [];
  const temperature_2m = [];

  for (let d=0; d<4; d++){
    const dk = new Date(dt);
    dk.setDate(dt.getDate() + d);
    const dateKey = dateKeyLocal(dk);

    for (let h=0; h<24; h++){
      times.push(`${dateKey}T${pad2(h)}:00`);
      precipitation.push(0);
      wind_speed_10m.push(5 + (h%6));
      wind_gusts_10m.push(10 + (h%8));
      temperature_2m.push(5 + (h%5));
    }
  }
  return { time: times, precipitation, wind_speed_10m, wind_gusts_10m, temperature_2m };
}

export async function generateWeatherScore(name, lat, lng, level="中級", summitElevM=null){
  const la = toNumber(lat);
  const lo = toNumber(lng);
  if (la === null || lo === null){
    const hourly = dummyHourly();
    const out = buildFromHourly(name, 36, 138, level, hourly, summitElevM, null);
    out._meta.source = "DUMMY";
    out._meta.note = "lat/lng invalid";
    for (const dk of Object.keys(out._details || {})){
      for (const t of Object.keys(out._details[dk] || {})){
        out._details[dk][t].source = "DUMMY";
      }
    }
    return out;
  }

  try{
    const { json, url } = await fetchOpenMeteo(la, lo);
    const hourly = json?.hourly;
    const apiElevM = toNumber(json?.elevation);

    const out = buildFromHourly(name, la, lo, level, hourly, summitElevM, apiElevM);
    out._meta.url = url;
    return out;
  }catch(e){
    const hourly = dummyHourly();
    const out = buildFromHourly(name, la, lo, level, hourly, summitElevM, null);
    out._meta.source = "DUMMY";
    out._meta.note = `fetch failed: ${String(e?.message || e)}`;
    for (const dk of Object.keys(out._details || {})){
      for (const t of Object.keys(out._details[dk] || {})){
        out._details[dk][t].source = "DUMMY";
      }
    }
    return out;
  }
}
