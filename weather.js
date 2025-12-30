// weather.js
// Open-Meteo を優先し、失敗時はダミーでフォールバック。
// さらに「登山向け」のA/B/C判定（worst-of + 難易度補正）を実装。
// index.html 側は generateWeatherScore(name, lat, lng) を呼ぶ前提。

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEZONE = "Asia/Tokyo";

// キャッシュ（localStorage）
const CACHE_PREFIX = "mount_weather_v3_";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1時間

// UIが使う時間帯（index.htmlと合わせる）
const TIME_SLOTS = ["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"];

/** ===== 判定ロジック（登山向け） =====
 *  基準（中級）:
 *  - 降水(mm/h): A<=0.2, B<=1.0, C>1.0
 *  - 平均風(m/s): A<=7,   B<=12,  C>12
 *  - 突風(m/s):  A<=12,  B<=17,  C>17
 *  - 気温(℃):    A>=5,   B>=0,   C<0  （低温リスクとして扱う）
 *
 *  難易度補正:
 *  - 初級: 風・突風・降水を厳しく（Cになりやすい）
 *  - 上級: 中級より少し緩め（経験者想定）
 *
 *  仕様:
 *  - 各要素を A/B/C に分け、最悪（CがあればC、なければB…）を最終判定にする。
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
  // 中級を基準に、初級は厳しく、上級は少し緩める
  // ※「登れる山だけ」フィルタが初級/上級も見るので、極端にはしない
  const base = {
    rainA: 0.2, rainB: 1.0,           // mm/h
    windA: 7,   windB: 12,            // m/s
    gustA: 12,  gustB: 17,            // m/s
    tempA: 5,   tempB: 0              // ℃（tempB未満はC）
  };

  if (level === "初級") {
    return {
      rainA: 0.0, rainB: 0.6,
      windA: 6,   windB: 10,
      gustA: 10,  gustB: 15,
      tempA: 7,   tempB: 2
    };
  }
  if (level === "上級") {
    return {
      rainA: 0.2, rainB: 1.4,
      windA: 8,   windB: 14,
      gustA: 14,  gustB: 20,
      tempA: 3,   tempB: -2
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
    // val >= aMax -> A, val >= bMax -> B, else C
    if (val >= aMax) return "A";
    if (val >= bMax) return "B";
    return "C";
  }
}

function mountainScore(level, metrics){
  // metrics: { precipitation, windspeed, gust, temp }
  const th = thresholdsByLevel(level);

  const sRain = scoreFromValue(metrics.precipitation, th.rainA, th.rainB, false);
  const sWind = scoreFromValue(metrics.windspeed,     th.windA, th.windB, false);
  const sGust = scoreFromValue(metrics.gust,          th.gustA, th.gustB, false);
  const sTemp = scoreFromValue(metrics.temp,          th.tempA, th.tempB, true);

  // 最悪勝ち（worst-of）
  let s = null;
  s = scoreWorst(s, sRain);
  s = scoreWorst(s, sWind);
  s = scoreWorst(s, sGust);
  s = scoreWorst(s, sTemp);

  // どれも取れない場合は null
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
  // wantIso: "YYYY-MM-DDTHH:00"
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
  // 4日分 × TIME_SLOTS を埋める
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
      // slot "06:00" -> wantIso "YYYY-MM-DDT06:00"
      const hour = slot.slice(0,2);
      const wantIso = `${dk}T${hour}:00`;

      const m = pickAtHour(hourly, wantIso);

      // 予報が取れない枠は null
      if (!m) {
        out[dk][slot] = null;
        details[dk][slot] = null;
        continue;
      }

      const judged = mountainScore(level, m);
      out[dk][slot] = judged.score ?? null;
      details[dk][slot] = {
        ...m,
        // 内訳も置いておく（UIで必要なら拡張できる）
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

  // ダミーは「山名のハッシュで固定化」してリロードで変わりにくくする
  const seed = hashCode(`${name}_${lat}_${lng}_${level}`);
  const rand = mulberry32(seed);

  for (let d = 0; d < 4; d++){
    const dt = new Date(now.getTime());
    dt.setDate(dt.getDate() + d);
    const dk = dateKey(dt);

    out[dk] = {};
    details[dk] = {};

    for (const slot of TIME_SLOTS){
      // 擬似的な値を作る
      const precipitation = clamp((rand() * 2.5), 0, 4);  // 0〜4mm/h
      const windspeed     = clamp((rand() * 16), 0, 20);  // 0〜20m/s
      const gust          = clamp(windspeed + rand()*8, 0, 28);
      const temp          = clamp((rand() * 18) - 3, -8, 20); // -8〜20℃

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
  // 座標は小数3桁で丸める（近距離は共有）
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
    // storage制限は無視（動作優先）
  }
}

/** ===== 公開API ===== */
export async function generateWeatherScore(name, lat, lng, level="中級"){
  // level は mountains.js に入っているはずなので、
  // 既存の呼び出し（name,lat,lng）でも、上位側で level を渡せるようにしておく。

  // 既にキャッシュがあれば使う
  const cached = loadCache(lat, lng);
  if (cached && cached.out && cached.details && cached.meta) {
    // meta.source は api/dummy
    return {
      ...cached.out,
      _details: cached.details,
      _meta: cached.meta
    };
  }

  // API取得
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

    const payload = { out, details, meta };
    saveCache(lat, lng, payload);

    return {
      ...out,
      _details: details,
      _meta: meta
    };
  }catch(e){
    const reason = (e && e.message) ? e.message : "unknown error";
    const dummy = dummyWeather(name, lat, lng, level, reason);

    const payload = { out: dummy.out, details: dummy.details, meta: dummy.meta };
    saveCache(lat, lng, payload);

    return {
      ...dummy.out,
      _details: dummy.details,
      _meta: dummy.meta
    };
  }
}
