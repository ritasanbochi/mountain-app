// weather.js (tenkura-like, v4)
// Open-Meteo を優先し、失敗時はダミーでフォールバック。
// 「てんくら寄せ」：Cを出しにくくし、雨風の"強さ"中心に判断。
// index.html 側は generateWeatherScore(name, lat, lng, level) を呼ぶ前提。

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ（localStorage）
const CACHE_PREFIX = "mount_weather_v4_"; // ★ v4にして旧キャッシュを無効化
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// UIが使う時間帯（index.htmlと合わせる）
const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

/** ===== 判定ロジック（てんくら寄せ・緩め） =====
 *  - 基本は「雨・風の強さ」で判断
 *  - 最終判定は worst-of（最悪が勝つ）
 *  - 難易度補正は控えめ（初級を少し厳しく、上級を少し緩く）
 *
 *  中級（基準）:
 *   降水(mm/h): A<=0.5, B<=2.0, C>2.0
 *   平均風(m/s): A<=10,  B<=15,  C>15
 *   突風(m/s):  A<=15,  B<=22,  C>22
 *   気温(℃):    A>=0,   B>=-5,  C<-5
 */

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
function toNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function pad2(n){ return String(n).padStart(2, "0"); }
function dateKey(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoNow(){
  return new Date().toISOString();
}
function scoreWorst(a, b){
  const pr = { A: 3, B: 2, C: 1 };
  if (!a) return b;
  if (!b) return a;
  return pr[a] <= pr[b] ? a : b; // 数値が小さいほど悪い
}

function thresholdsByLevel(level){
  // てんくら寄せ：補正は控えめ
  const base = {
    rainA: 0.5, rainB: 2.0,   // mm/h
    windA: 10,  windB: 15,    // m/s
    gustA: 15,  gustB: 22,    // m/s
    tempA: 0,   tempB: -5     // ℃（tempB未満はC）
  };

  if (level === "初級") {
    return {
      rainA: 0.3, rainB: 1.5,
      windA: 9,   windB: 14,
      gustA: 14,  gustB: 20,
      tempA: 2,   tempB: -3
    };
  }
  if (level === "上級") {
    return {
      rainA: 0.7, rainB: 2.5,
      windA: 11,  windB: 16,
      gustA: 16,  gustB: 24,
      tempA: -2,  tempB: -7
    };
  }
  return base; // 中級
}

function scoreFromValue(val, aMax, bMax, reverse=false){
  // reverse=false: 小さいほど良い（雨/風/突風）
  // reverse=true : 大きいほど良い（気温）
  if (val === null) return null;
  if (!reverse) {
    if (val <= aMax) return "A";
    if (val <= bMax) return "B";
    return "C";
  } else {
    if (val >= aMax) return "A";
    if (val >= bMax) return "B";
    return "C";
  }
}

function mountainScore(level, metrics){
  const th = thresholdsByLevel(level);

  const sRain = scoreFromValue(metrics.precipitation, th.rainA, th.rainB, false);
  const sWind = scoreFromValue(metrics.windspeed,     th.windA, th.windB, false);
  const sGust = scoreFromValue(metrics.gust,          th.gustA, th.gustB, false);
  const sTemp = scoreFromValue(metrics.temp,          th.tempA, th.tempB, true);

  // 最悪勝ち
  let s = null;
  s = scoreWorst(s, sRain);
  s = scoreWorst(s, sWind);
  s = scoreWorst(s, sGust);
  s = scoreWorst(s, sTemp);

  return {
    score: s,
    components: { rain: sRain, wind: sWind, gust: sGust, temp: sTemp },
    thresholds: th
  };
}

/** ===== Open-Meteo 取得 =====
 *  hourly:
 *   - precipitation (mm)
 *   - wind_speed_10m (m/s)
 *   - wind_gusts_10m (m/s)
 *   - temperature_2m (°C)
 */
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
  if (!res.ok) {
    throw new Error(`Open-Meteo HTTP ${res.status}`);
  }
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

  return {
    precipitation: p,
    windspeed: w,
    gust: g,
    temp: t
  };
}

function buildFromHourly(name, lat, lng, level, hourly){
  const out = {};
  const details = {};

  for (let d = 0; d < 4; d++){
    const dt = new Date();
    dt.setHours(0,0,0,0);
    dt.setDate(dt.getDate() + d);
    const dk = dateKey(dt);

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

      const judged = mountainScore(level, m);
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
    const dk = dateKey(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      // “緩め”ロジックに合わせて、ダミー値も過激にしない
      const precipitation = clamp((rand() * 2.8), 0, 5);    // 0〜5mm/h
      const windspeed     = clamp((rand() * 14), 0, 18);   // 0〜18m/s
      const gust          = clamp(windspeed + rand()*8, 0, 26);
      const temp          = clamp((rand() * 18) - 2, -10, 22); // -10〜22℃

      const m = { precipitation, windspeed, gust, temp };
      const judged = mountainScore(level, m);

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
