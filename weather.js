// weather.js v11
// - 中腹/山頂の2段表示は維持
// - スコアは「降水主軸」+「風/気温は“その山の基準(地域×標高帯×月)”からの悪化分」で補助
// - 月(季節)で baseline を可変にして、冬の厳しさ/夏の緩さを自然に反映

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ
const CACHE_PREFIX = "mount_weather_v11_";
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

// =====================================================
// 0) 追加山向け：Open-Meteo Geocoding（山名→緯度経度/標高）
// =====================================================

function normalizeNameForGeocode(name){
  // よくある表記ゆれの軽い補正（必要なら増やしてOK）
  return String(name)
    .replaceAll("ヶ", "ケ")
    .trim();
}

async function geocodeOnce(query){
  const params = new URLSearchParams({
    name: query,
    count: "10",
    language: "ja",
    format: "json"
  });
  const url = `${OPEN_METEO_GEOCODE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const json = await res.json();
  return { json, url };
}

function pickBestJapanResult(results){
  if (!Array.isArray(results) || results.length === 0) return null;

  // 1) まず country_code === "JP" を優先
  const jp = results.filter(r => String(r?.country_code || "").toUpperCase() === "JP");
  const pool = jp.length ? jp : results;

  // 2) elevation があるものを優先
  const withElev = pool.filter(r => Number.isFinite(Number(r?.elevation)));
  const pool2 = withElev.length ? withElev : pool;

  // 3) 先頭（関連度順のはず）
  return pool2[0] || null;
}

/**
 * 山名から緯度経度・標高を推定して返す。
 * - 成功時：{ lat, lng, elev, _geocodeUrl }
 * - 失敗時：null
 */
export async function geocodeMountain(name){
  const base = normalizeNameForGeocode(name);
  const candidates = [
    `${base} 山`,
    `${base} 岳`,
    `${base}`,
    `${base} 日本`,
  ];

  let lastErr = null;
  for (const q of candidates){
    try{
      const { json, url } = await geocodeOnce(q);
      const best = pickBestJapanResult(json?.results);
      if (!best) continue;
      const lat = Number(best.latitude);
      const lng = Number(best.longitude);
      const elev = Number(best.elevation);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      return {
        lat,
        lng,
        elev: Number.isFinite(elev) ? Math.round(elev) : null,
        _geocodeUrl: url,
        _geocodeName: String(best.name || q),
        _geocodeCountry: String(best.country || ""),
      };
    }catch(e){
      lastErr = e;
    }
  }

  if (lastErr) console.warn("geocodeMountain failed:", name, lastErr);
  return null;
}

// =====================================================
// 1) 地域×標高帯×月 の「基準（その山のふつう）」
// =====================================================

// 気温減率（平年推定にも使う） 6.5℃/1000m
const LAPSE_C_PER_1000M = 6.5;

// 地域判定（ざっくり：日本向け）
function detectRegion(lat, lng){
  if (lat >= 42.0) return "北海道";
  if (lat >= 38.0) return "東北";
  if (lat >= 35.5 && lng >= 137.0 && lng <= 141.5) return "関東甲信";
  if (lat >= 35.5 && lng < 137.0) return "北陸";
  if (lat >= 34.3 && lat < 35.5 && lng >= 136.0 && lng <= 139.2) return "東海";
  if (lat >= 33.8 && lat < 35.5 && lng >= 134.0 && lng < 136.5) return "近畿";
  if (lat >= 32.8 && lat < 34.3 && lng >= 132.0 && lng < 134.5) return "中国四国";
  if (lat < 32.8) return "九州";
  return "本州";
}

// 地域ごとの「海抜0mの基準（年平均っぽい）」
// ※ここを月別補正で動かす
const REGION_BASE = {
  "北海道":   { tempSea:  5, wind: 6.5 },
  "東北":     { tempSea:  9, wind: 6.0 },
  "北陸":     { tempSea: 11, wind: 6.5 },
  "関東甲信": { tempSea: 13, wind: 5.5 },
  "東海":     { tempSea: 14, wind: 5.5 },
  "近畿":     { tempSea: 14, wind: 5.5 },
  "中国四国": { tempSea: 15, wind: 5.5 },
  "九州":     { tempSea: 16, wind: 5.8 },
  "本州":     { tempSea: 13, wind: 5.8 },
};

function elevBandFactorWind(elevM){
  // 標高が上がるほど“普段から”風は強め、という基準を少し足す
  if (!Number.isFinite(elevM)) return 0;
  if (elevM < 1000) return 0.0;
  if (elevM < 2000) return 0.8;
  if (elevM < 2800) return 1.4;
  return 1.8;
}

/**
 * 月別補正（ざっくり）
 * - tempSea は「冬は下げる、夏は上げる」
 * - wind は「冬〜春はやや上げる、夏は少し下げる」
 *
 * ここは“てんくら寄せ”のチューニングポイント。
 * まずは過激にしない値にしてある。
 */
function monthAdjust(month, region){
  // month: 1..12
  // 気温（海抜0m基準）補正 ℃
  // 北ほど季節振幅が大きい → 北海道/東北は倍率を少し増やす
  const amp =
    (region === "北海道") ? 1.15 :
    (region === "東北")   ? 1.10 :
    1.00;

  // 日本の季節感（ざっくり）
  // 12-2: 真冬 / 3: 早春 / 4-5: 春 / 6: 梅雨 / 7-8: 真夏 / 9: 初秋 / 10-11: 秋
  let dTempSea = 0;
  if ([12,1,2].includes(month)) dTempSea = -6.0;
  else if (month === 3) dTempSea = -3.0;
  else if ([4,5].includes(month)) dTempSea = -1.0;
  else if (month === 6) dTempSea = +0.5;
  else if ([7,8].includes(month)) dTempSea = +3.0;
  else if (month === 9) dTempSea = +1.5;
  else if ([10,11].includes(month)) dTempSea = -1.5;

  dTempSea *= amp;

  // 風（基準風速）補正 m/s
  // 冬〜春は気圧配置で強風日が増える想定、夏は弱め
  let dWind = 0;
  if ([12,1,2].includes(month)) dWind = +0.8;
  else if ([3,4].includes(month)) dWind = +0.5;
  else if ([5,6].includes(month)) dWind = +0.2;
  else if ([7,8].includes(month)) dWind = -0.2;
  else if (month === 9) dWind = +0.1;
  else if ([10,11].includes(month)) dWind = +0.3;

  // 北陸は冬型で風が強めになりやすい想定で少し上乗せ
  if (region === "北陸" && [12,1,2].includes(month)) dWind += 0.2;

  return { dTempSea, dWind };
}

function baselineAtElevation(lat, lng, elevM, month){
  const region = detectRegion(lat, lng);
  const base = REGION_BASE[region] ?? REGION_BASE["本州"];
  const m = (Number.isFinite(month) ? month : (new Date().getMonth()+1));
  const adj = monthAdjust(m, region);

  // 月別補正された海抜0m基準
  const tempSeaMonthly = base.tempSea + adj.dTempSea;
  const windBaseMonthly = base.wind + adj.dWind;

  // “平年っぽい”気温（海抜0m→標高へ）
  const temp = tempSeaMonthly - (LAPSE_C_PER_1000M * (elevM / 1000));

  // “平年っぽい”風（地域の基準＋標高帯）
  const wind = windBaseMonthly + elevBandFactorWind(elevM);

  // 突風の基準：風の1.6倍（固定でOK）
  const gust = wind * 1.6;

  return {
    region,
    month: m,
    temp,
    wind,
    gust,
    elev: elevM,
    _components: { tempSeaMonthly, windBaseMonthly, dTempSea: adj.dTempSea, dWind: adj.dWind }
  };
}

// =====================================================
// 2) スコア判定（降水主軸 + 風/気温は“基準からの悪化分”）
// =====================================================

function thresholdsByLevel(level){
  const rain = (level === "初級")
    ? { A: 0.8, B: 3.5 }
    : (level === "上級")
      ? { A: 1.2, B: 4.5 }
      : { A: 1.0, B: 4.0 };

  const windDelta = (level === "初級")
    ? { warn: 4.0, danger: 7.0 }
    : (level === "上級")
      ? { warn: 6.0, danger: 10.0 }
      : { warn: 5.0, danger: 9.0 };

  const coldDelta = (level === "初級")
    ? { warn: 5, danger: 10 }
    : (level === "上級")
      ? { warn: 7, danger: 13 }
      : { warn: 6, danger: 12 };

  return { rain, windDelta, coldDelta };
}

function baseScoreByPrecip(p, th){
  if (p === null) return null;
  if (p <= th.rain.A) return "A";
  if (p <= th.rain.B) return "B";
  return "C";
}

function applyWindSupportByDelta(score, wind, gust, baseWind, baseGust, th){
  const dW = (wind !== null && baseWind !== null) ? (wind - baseWind) : null;
  const dG = (gust !== null && baseGust !== null) ? (gust - baseGust) : null;

  const danger =
    (dW !== null && dW >= th.windDelta.danger) ||
    (dG !== null && dG >= th.windDelta.danger * 1.2);

  if (danger) return "C";

  const warn =
    (dW !== null && dW >= th.windDelta.warn) ||
    (dG !== null && dG >= th.windDelta.warn * 1.2);

  if (warn && score === "A") return "B";
  return score;
}

function applyTempSupportByDelta(score, temp, baseTemp, th){
  const dC = (temp !== null && baseTemp !== null) ? (baseTemp - temp) : null;
  if (dC === null) return score;

  if (dC >= th.coldDelta.danger) return "C";
  if (dC >= th.coldDelta.warn && score === "A") return "B";
  return score;
}

function scoreBySummitWithBaseline(level, summitMetrics, baselineSummit){
  const th = thresholdsByLevel(level);

  let s = baseScoreByPrecip(summitMetrics.precipitation, th);

  s = applyWindSupportByDelta(
    s,
    summitMetrics.windspeed,
    summitMetrics.gust,
    baselineSummit?.wind ?? null,
    baselineSummit?.gust ?? null,
    th
  );

  s = applyTempSupportByDelta(
    s,
    summitMetrics.temp,
    baselineSummit?.temp ?? null,
    th
  );

  return { score: s, thresholds: th };
}

// =====================================================
// 3) “APIの地表標高”から中腹/山頂へ補正（表示用）
// =====================================================

function windExposureFactor(deltaElevM){
  if (!Number.isFinite(deltaElevM)) return 1.0;
  const k = 1.0 + 0.15 * (deltaElevM / 1000);
  return clamp(k, 1.0, 1.30);
}

function adjustToElevation(raw, targetElevM, apiElevM){
  const tgt = toNumber(targetElevM);
  const api = toNumber(apiElevM);

  const out = { ...raw };

  if (tgt === null || api === null) {
    out._elev = { target: tgt, api: api, delta: null };
    return out;
  }

  const delta = tgt - api;
  if (out.temp !== null) out.temp = out.temp - (LAPSE_C_PER_1000M * (delta / 1000));

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

// =====================================================
// 4) Open-Meteo取得（elevation=は渡さない）
// =====================================================
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

  return {
    precipitation: toNumber(hourly.precipitation?.[idx]),
    windspeed:     toNumber(hourly.wind_speed_10m?.[idx]),
    gust:          toNumber(hourly.wind_gusts_10m?.[idx]),
    temp:          toNumber(hourly.temperature_2m?.[idx]),
  };
}

// =====================================================
// 5) 組み立て（中腹/山頂 + baseline(月別)差分判定）
// =====================================================
function monthFromDateKey(dateKey){
  // "YYYY-MM-DD" -> month 1..12
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

    // その日(月)に合わせて baseline を作る（＝季節差が出る）
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

      const raw = pickAtHour(hourly, wantIso);
      if (!raw) {
        out[dk][slot] = null;
        details[dk][slot] = null;
        continue;
      }

      // 表示用：中腹/山頂へ補正した“予報値”
      const summit = adjustToElevation(raw, summitElevM, apiElevM);
      const mid    = adjustToElevation(raw, midElevM,    apiElevM);

      // スコア：山頂の「基準(月別)との差」で判定（安全側）
      const judged = scoreBySummitWithBaseline(level, summit, baselineSummit);

      out[dk][slot] = judged.score ?? null;

      details[dk][slot] = {
        precipitation: raw.precipitation,

        // 中腹（予報）
        windspeed_mid: mid.windspeed,
        gust_mid:      mid.gust,
        temp_mid:      mid.temp,

        // 山頂（予報）
        windspeed_summit: summit.windspeed,
        gust_summit:      summit.gust,
        temp_summit:      summit.temp,

        // baseline（その山のふつう：月別）
        baseline_region: baselineSummit?.region ?? null,
        baseline_month: baselineSummit?.month ?? month,

        baseline_wind_mid: baselineMid?.wind ?? null,
        baseline_gust_mid: baselineMid?.gust ?? null,
        baseline_temp_mid: baselineMid?.temp ?? null,

        baseline_wind_summit: baselineSummit?.wind ?? null,
        baseline_gust_summit: baselineSummit?.gust ?? null,
        baseline_temp_summit: baselineSummit?.temp ?? null,

        // debug用（必要なら表示に使える）
        _baseline_components: {
          mid: baselineMid?._components ?? null,
          summit: baselineSummit?._components ?? null
        },

        _thresholds: judged.thresholds,
        _elev: {
          api: toNumber(apiElevM),
          mid: toNumber(midElevM),
          summit: toNumber(summitElevM),
        }
      };
    }
  }

  // meta用に“今日”の baseline region/month を返しておく
  const todayMonth = new Date().getMonth() + 1;
  const metaBaseline = (Number.isFinite(Number(summitElevM)))
    ? baselineAtElevation(lat, lng, Number(summitElevM), todayMonth)
    : null;

  return {
    out,
    details,
    midElevM,
    baselineRegion: metaBaseline?.region ?? null,
    baselineMonth: metaBaseline?.month ?? todayMonth
  };
}

// =====================================================
// 6) ダミー（フォールバック）
// =====================================================
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
    const month = monthFromDateKey(dk);

    const baseS = (summit !== null) ? baselineAtElevation(lat, lng, summit, month) : null;
    const baseM = (mid !== null) ? baselineAtElevation(lat, lng, mid, month) : null;

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      const precipitation = clamp(rand() * 5.0, 0, 8);
      const windRaw = clamp(rand() * 12, 0, 20);
      const gustRaw = clamp(windRaw + rand()*10, 0, 34);
      const tempRaw = clamp((rand() * 18) - 2, -12, 22);

      const tempSummit = (summit !== null) ? (tempRaw - 5) : tempRaw;
      const tempMid    = (mid !== null) ? (tempRaw - 2.5) : tempRaw;

      const summitMetrics = { precipitation, windspeed: windRaw, gust: gustRaw, temp: tempSummit };
      const judged = scoreBySummitWithBaseline(level, summitMetrics, baseS);

      out[dk][slot] = judged.score ?? "B";
      details[dk][slot] = {
        precipitation,
        windspeed_mid: windRaw,
        gust_mid: gustRaw,
        temp_mid: tempMid,
        windspeed_summit: windRaw,
        gust_summit: gustRaw,
        temp_summit: tempSummit,

        baseline_region: baseS?.region ?? null,
        baseline_month: baseS?.month ?? month,

        baseline_wind_mid: baseM?.wind ?? null,
        baseline_gust_mid: baseM?.gust ?? null,
        baseline_temp_mid: baseM?.temp ?? null,
        baseline_wind_summit: baseS?.wind ?? null,
        baseline_gust_summit: baseS?.gust ?? null,
        baseline_temp_summit: baseS?.temp ?? null,

        _thresholds: judged.thresholds,
        _elev: { api: null, mid, summit }
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

// =====================================================
// 7) キャッシュ
// =====================================================
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

    const fetchedAt = obj?.fetchedAt;
    if (!fetchedAt) return null;
    const ts = Date.parse(fetchedAt);
    if (!Number.isFinite(ts)) return null;
    if (Date.now() - ts > CACHE_TTL_MS) return null;

    return obj;
  }catch{
    return null;
  }
}
function saveCache(lat, lng, summitElevM, payload){
  try{
    const key = cacheKey(lat, lng, summitElevM);
    localStorage.setItem(key, JSON.stringify(payload));
  }catch{
    // ignore
  }
}

// =====================================================
// 8) メイン：山のスコア生成
// =====================================================
export async function generateWeatherScore(name, lat, lng, level="中級", summitElevM=null){
  const cached = loadCache(lat, lng, summitElevM);
  if (cached){
    return { ...cached.out, _details: cached.details, _meta: cached.meta };
  }

  try{
    const { json, url } = await fetchOpenMeteo(lat, lng);

    const hourly = json?.hourly;
    if (!hourly) throw new Error("Open-Meteo hourly missing");

    const apiElev = toNumber(json?.elevation);
    const { out, details, midElevM, baselineRegion, baselineMonth } = buildFromHourly(
      name, lat, lng, level, hourly, summitElevM, apiElev
    );

    const meta = {
      source: "api",
      fetchedAt: isoNow(),
      lat, lng,
      url,
      elevation_api: apiElev,
      elevation_summit: Number.isFinite(Number(summitElevM)) ? Math.round(Number(summitElevM)) : null,
      elevation_mid: Number.isFinite(Number(midElevM)) ? Math.round(Number(midElevM)) : null,
      baseline_region: baselineRegion,
      baseline_month: baselineMonth
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
