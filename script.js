/* ── Configuration ── */

const MODELS = [
  { id: 'ukmo_seamless', short: 'UKMO', label: 'UK Met Office' },
  { id: 'ecmwf_ifs025', short: 'ECMWF', label: 'ECMWF (Europe)' },
  { id: 'gfs_seamless', short: 'GFS', label: 'NOAA GFS (US)' },
  { id: 'icon_seamless', short: 'ICON', label: 'DWD ICON (Germany)' },
  { id: 'gem_seamless', short: 'GEM', label: 'Env. Canada GEM' },
  { id: 'meteofrance_seamless', short: 'MF', label: 'Météo-France' },
  { id: 'knmi_seamless', short: 'KNMI', label: 'KNMI (Netherlands)' },
  { id: 'dmi_seamless', short: 'DMI', label: 'DMI (Denmark)' },
];

const METRICS = [
  { key: 'precipitation_probability', label: 'Precipitation Probability', unit: '%' },
  { key: 'precipitation', label: 'Precipitation Amount', unit: 'mm' },
  { key: 'cloud_cover', label: 'Cloud Cover', unit: '%' },
  { key: 'wind_speed_10m', label: 'Wind Speed (10m)', unit: 'km/h' },
  { key: 'wind_gusts_10m', label: 'Wind Gusts (10m)', unit: 'km/h' },
  { key: 'temperature_2m', label: 'Temperature', unit: '°C' },
];

const DEFAULT_START = 6;
const DEFAULT_END = 22;
const AGREEMENT_THRESHOLD = 0.6;
const MODEL_LOOKUP = new Map(MODELS.map(m => [m.id, m]));

/* ── DOM refs ── */

const form = document.getElementById('search-form');
const input = document.getElementById('postcode-input');
const checkBtn = document.getElementById('check-btn');
const locateBtn = document.getElementById('locate-btn');
const loadingEl = document.getElementById('loading-indicator');
const errorEl = document.getElementById('error-display');
const resultsSection = document.getElementById('results-section');
const forecastHeading = document.getElementById('forecast-heading');
const tablesContainer = document.getElementById('tables-container');
const hourStart = document.getElementById('hour-start');
const hourEnd = document.getElementById('hour-end');
const rangeHint = document.getElementById('range-hint');
const selectDay = document.getElementById('forecast-date');
const updateBtn = document.getElementById('update-btn');

/* ── Helpers ── */

function fmt(val, unit, decimals) {
  if (val === null || val === undefined || val === '') return '\u2014';
  const n = Number(val);
  if (isNaN(n)) return '\u2014';
  return n.toFixed(decimals ?? (Number.isInteger(n) ? 0 : 1)) + (unit ? unit : '');
}

function _fmtTime(iso) { return iso.slice(11, 16); }

function formatHour(h) {
  return String(Number(h)).padStart(2, '0') + ':00';
}

function normalizePostcode(pc) {
  if (!pc || typeof pc !== 'string') return '';
  const s = pc.trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 5 || s.length > 7) return '';
  return s;
}

/* ── State ── */

let lastRawData = null;
let lastSunrise = null;
let lastSunset = null;
let lastRows = null;
let lastModels = null;
let lastSelectedDate = null;
let requestToken = 0;

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateLong(d) {
  const opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString('en-GB', opts);
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

function getNextSaturday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 6 ? 0 : (6 - day + 7) % 7;
  return addDays(now, diff);
}

/* ── API calls ── */

async function geocode(postcode) {
  const pc = normalizePostcode(postcode);
  if (!pc) throw new Error('Enter a valid UK postcode (e.g. SW1A 1AA).');
  const url = `https://api.postcodes.io/postcodes/${pc}`;
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`Postcode "${input.value.trim().toUpperCase()}" not found. Check it and try again.`);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}). Try again.`);
  let body;
  try { body = await res.json(); } catch { throw new Error('Invalid response from postcodes.io.'); }
  if (!body || !body.result) throw new Error('Unexpected response from postcodes.io.');
  return { lat: body.result.latitude, lon: body.result.longitude };
}

async function reverseGeocode(lat, lon) {
  const url = `https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  let body;
  try { body = await res.json(); } catch { return null; }
  if (!body || !body.result || !body.result.length) return null;
  return body.result[0].postcode;
}

async function handleUseLocation() {
  if (locateBtn.disabled) return;
  if (!('geolocation' in navigator)) { showError('Geolocation is not available in this browser.'); return; }
  locateBtn.disabled = true;
  locateBtn.textContent = 'Locating…';
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000 });
    });
    const { latitude: lat, longitude: lon } = pos.coords;
    const pc = await reverseGeocode(lat, lon);
    if (!pc) { showError('Could not find a postcode for your location. Enter a postcode instead.'); return; }
    input.value = pc.replace(/\s/g, '');
    form.requestSubmit();
  } catch (err) {
    if (err.code === 1) showError('Location access denied. Enable location services or enter a postcode.');
    else if (err.code === 2) showError('Location unavailable. Try again or enter a postcode.');
    else showError('Could not get location. Enter a postcode instead.');
  } finally {
    locateBtn.disabled = false;
    locateBtn.textContent = 'Use my location';
  }
}

async function fetchForecast(lat, lon) {
  const hourlyParams = METRICS.map(m => m.key).join(',');
  const modelIds = MODELS.map(m => m.id).join(',');
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: hourlyParams,
    daily: 'sunrise,sunset',
    models: modelIds,
    forecast_days: 7,
    timezone: 'Europe/London',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast failed (HTTP ${res.status}). Try again.`);
  let body;
  try { body = await res.json(); } catch { throw new Error('Invalid response from weather service.'); }
  if (body.error) throw new Error(body.reason || 'Weather service returned an error.');
  return body;
}

function getSunTimes(rawData, selectedDate) {
  if (!rawData || !rawData.daily) return null;
  const target = dateStr(selectedDate);
  const i = rawData.daily.time.findIndex(t => t === target);
  if (i === -1) return null;
  const keys = Object.keys(rawData.daily);
  const sunriseKey = keys.find(k => k.startsWith('sunrise_'));
  const sunsetKey = keys.find(k => k.startsWith('sunset_'));
  if (!sunriseKey || !sunsetKey) return null;
  const sunrise = rawData.daily[sunriseKey]?.[i];
  const sunset = rawData.daily[sunsetKey]?.[i];
  if (!sunrise || !sunset) return null;
  return { sunrise: _fmtTime(sunrise), sunset: _fmtTime(sunset) };
}

/* ── Data parsing ── */

function parseHourly(data, models, saturdayDate) {
  if (!data || !data.hourly || !data.hourly.time) return { rows: [], modelsPresent: [] };
  const hourly = data.hourly;
  const times = hourly.time;
  const targetDate = dateStr(saturdayDate);

  const idxMap = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i].startsWith(targetDate)) idxMap.push(i);
  }

  const modelsPresent = [];
  for (const m of models) {
    const found = {};
    for (const metric of METRICS) {
      const key = metric.key + '_' + m.id;
      if (hourly[key] !== undefined && hourly[key] !== null) {
        found[metric.key] = key;
      }
    }
    modelsPresent.push({ id: m.id, keys: found, present: Object.keys(found).length > 0 });
  }

  const rows = [];
  for (const idx of idxMap) {
    const hour = parseInt(times[idx].slice(11, 13), 10);
    const row = { hour, models: {} };
    for (const mp of modelsPresent) {
      row.models[mp.id] = {};
      for (const metric of METRICS) {
        const key = mp.keys[metric.key];
        if (key && hourly[key] && hourly[key][idx] !== undefined && hourly[key][idx] !== null) {
          row.models[mp.id][metric.key] = hourly[key][idx];
        }
      }
    }
    rows.push(row);
  }

  return { rows, modelsPresent };
}

function filterHours(rows, startH, endH) {
  return rows.filter(r => r.hour >= startH && r.hour <= endH);
}

/* ── Agreement logic ── */

function classifyPrecip(val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  if (val < 20) return 'dry';
  if (val <= 50) return 'mixed';
  return 'wet';
}

function classifyCell(key, val) {
  if (val === null || val === undefined || isNaN(val)) return null;
  if (key === 'precipitation_probability') {
    if (val < 20) return 'low';
    if (val <= 50) return 'mid';
    return 'high';
  }
  if (key === 'precipitation') {
    if (val < 0.1) return 'low';
    if (val <= 1.0) return 'mid';
    return 'high';
  }
  if (key === 'wind_speed_10m') {
    if (val < 20) return 'low';
    if (val <= 40) return 'mid';
    return 'high';
  }
  if (key === 'wind_gusts_10m') {
    if (val < 30) return 'low';
    if (val <= 50) return 'mid';
    return 'high';
  }
  if (key === 'cloud_cover') {
    if (val < 30) return 'low';
    if (val <= 70) return 'mid';
    return 'high';
  }
  if (key === 'temperature_2m') {
    if (val < 10) return 'low';
    if (val <= 20) return 'mid';
    return 'high';
  }
  return null;
}

function hourlyAgreement(rows, modelsPresent) {
  return rows.map(row => {
    let dry = 0, wet = 0, uncertain = 0, missing = 0;
    for (const mp of modelsPresent) {
      const val = row.models[mp.id]?.precipitation_probability;
      if (val === undefined) { missing++; continue; }
      const c = classifyPrecip(val);
      if (c === 'dry') dry++;
      else if (c === 'wet') wet++;
      else if (c === 'mixed') uncertain++;
    }
    const total = dry + wet + uncertain;
    return { dry, wet, uncertain, missing, total };
  });
}

function modelDayAgreement(rows, modelsPresent) {
  return modelsPresent.map(mp => {
    let dry = 0, total = 0;
    for (const row of rows) {
      const val = row.models[mp.id]?.precipitation_probability;
      if (val === undefined) continue;
      total++;
      if (classifyPrecip(val) === 'dry') dry++;
    }
    return { modelId: mp.id, dry, total };
  });
}

/* ── Table builder ── */

function buildTables(rows, modelsPresent, startH, endH, filtered, agreement) {
  tablesContainer.innerHTML = '';
  if (!filtered.length) {
    tablesContainer.innerHTML = '<p class="no-data">No data for the selected hour range.</p>';
    return;
  }

  const visibleModels = modelsPresent.filter(m => m.present);
  if (!visibleModels.length) {
    tablesContainer.innerHTML = '<p class="no-data">No model data returned. Try a different postcode or come back later.</p>';
    return;
  }

  const modelDayAgree = modelDayAgreement(filtered, visibleModels);
  for (const metric of METRICS) {
    const metricModels = visibleModels.filter(mp => filtered.some(r => r.models[mp.id]?.[metric.key] !== undefined));
    if (!metricModels.length) continue;
    const section = document.createElement('section');
    section.className = 'metric-section';

    const header = document.createElement('h3');
    header.className = 'metric-header';
    header.textContent = `${metric.label} (${metric.unit})`;
    section.appendChild(header);

    const wrap = document.createElement('div');
    wrap.className = 'weather-table-wrap';

    const table = document.createElement('table');
    table.className = 'weather-table';

    /* thead */
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const timeTh = document.createElement('th');
    timeTh.textContent = 'Time';
    headRow.appendChild(timeTh);
    for (const mp of metricModels) {
      const th = document.createElement('th');
      const mDef = MODEL_LOOKUP.get(mp.id);
      th.textContent = mDef ? mDef.short : mp.id.slice(0, 4);
      th.title = mDef ? mDef.label : mp.id;
      th.className = 'model-label';
      headRow.appendChild(th);
    }
    if (metric.key === 'precipitation_probability') {
      const agreeTh = document.createElement('th');
      agreeTh.textContent = 'Agreement';
      headRow.appendChild(agreeTh);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    /* tbody */
    const tbody = document.createElement('tbody');
    for (let ri = 0; ri < filtered.length; ri++) {
      const row = filtered[ri];
      const tr = document.createElement('tr');

      const timeTd = document.createElement('td');
      timeTd.textContent = formatHour(row.hour);
      tr.appendChild(timeTd);

      for (const mp of metricModels) {
        const td = document.createElement('td');
        const val = row.models[mp.id]?.[metric.key];
        if (val === undefined) {
          td.textContent = '\u2014';
          td.className = 'cell-missing';
        } else {
          const clazz = classifyCell(metric.key, val);
          if (clazz) td.className = 'cell-' + clazz;
          const decimals = metric.key === 'precipitation' || metric.key === 'wind_speed_10m' || metric.key === 'wind_gusts_10m' || metric.key === 'temperature_2m' ? 1 : 0;
          td.textContent = fmt(val, '', decimals);
        }
        tr.appendChild(td);
      }

      /* Agreement column (precip probability only) */
      if (metric.key === 'precipitation_probability') {
        const aTd = document.createElement('td');
        aTd.className = 'agreement-col';
        const a = agreement[ri];
        if (a.total === 0) {
          aTd.textContent = '\u2014';
        } else {
          const pct = Math.round((a.dry / a.total) * 100);
          if (pct >= 80) { aTd.textContent = `${a.dry}/${a.total} agree dry`; aTd.className += ' high'; }
          else if (pct >= Math.round(AGREEMENT_THRESHOLD * 100)) { aTd.textContent = `${a.dry}/${a.total} agree dry`; aTd.className += ' medium'; }
          else if (a.wet >= a.total * AGREEMENT_THRESHOLD) { aTd.textContent = `${a.wet}/${a.total} agree wet`; aTd.className += ' low'; }
          else { aTd.textContent = `Split`; aTd.className += ' medium'; }
        }
        tr.appendChild(aTd);
      }

      tbody.appendChild(tr);
    }

    /* Agreement row at bottom (precip probability only) */
    if (metric.key === 'precipitation_probability') {
      const agreeTr = document.createElement('tr');
      agreeTr.className = 'agreement-row';
      const labelTd = document.createElement('td');
      labelTd.textContent = 'Dry hours';
      agreeTr.appendChild(labelTd);

      for (const mp of metricModels) {
        const td = document.createElement('td');
        const md = modelDayAgree.find(a => a.modelId === mp.id);
        if (md && md.total > 0) {
          td.textContent = `${md.dry}/${md.total}`;
          td.className = md.dry / md.total >= AGREEMENT_THRESHOLD ? 'model-agree-dry' : 'model-agree-other';
        } else {
          td.textContent = '\u2014';
          td.className = 'cell-missing';
        }
        agreeTr.appendChild(td);
      }
      const emptyAgreeTd = document.createElement('td');
      agreeTr.appendChild(emptyAgreeTd);
      tbody.appendChild(agreeTr);
    }

    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    tablesContainer.appendChild(section);
  }
}

/* ── Verdict ── */

function getVerdict(filtered, visibleModels, aggr) {
  let dry = 0, wet = 0, split = 0;
  for (const a of aggr) {
    if (a.total === 0) continue;
    const dryPct = a.dry / a.total;
    const wetPct = a.wet / a.total;
    if (dryPct >= AGREEMENT_THRESHOLD) dry++;
    else if (wetPct >= AGREEMENT_THRESHOLD) wet++;
    else split++;
  }
  const total = dry + wet + split;
  if (total === 0) return { id: 'nodata', text: 'Insufficient data', cssClass: 'verdict-nodata' };
  const dryPct = dry / total;
  const wetPct = wet / total;
  if (dryPct >= AGREEMENT_THRESHOLD) return { id: 'outdoor', text: 'Outdoor looks good', cssClass: 'verdict-outdoor', icon: 'sun' };
  if (wetPct >= AGREEMENT_THRESHOLD) return { id: 'indoor', text: 'Indoor suggested', cssClass: 'verdict-indoor', icon: 'rain' };
  return { id: 'uncertain', text: 'Too close to call \u2014 check again tomorrow', cssClass: 'verdict-uncertain', icon: 'cloud' };
}

function renderVerdictIcon(iconId) {
  if (iconId === 'sun') return '<svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  if (iconId === 'rain') return '<svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 14c0-6 18-6 18 0" stroke="currentColor" stroke-width="2" fill="currentColor" opacity="0.25"/><path d="M7 18l-1 3M12 18l-1 3M17 18l-1 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  if (iconId === 'cloud') return '<svg aria-hidden="true" viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 14c0-6 18-6 18 0" stroke="currentColor" stroke-width="2" fill="currentColor" opacity="0.25"/><path d="M5 16c0-4 14-4 14 0" stroke="currentColor" stroke-width="1.5" fill="currentColor" opacity="0.15"/><path d="M8 18h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return '';
}

function buildConsensusSummary(filtered, visibleModels) {
  let tempSum = 0, tempCount = 0, cloudSum = 0, cloudCount = 0, windSum = 0, windCount = 0, precipSum = 0, precipCount = 0;
  for (const row of filtered) {
    for (const mp of visibleModels) {
      const t = row.models[mp.id]?.temperature_2m;
      if (t !== undefined && t !== null) { tempSum += Number(t); tempCount++; }
      const c = row.models[mp.id]?.cloud_cover;
      if (c !== undefined && c !== null) { cloudSum += Number(c); cloudCount++; }
      const w = row.models[mp.id]?.wind_speed_10m;
      if (w !== undefined && w !== null) { windSum += Number(w); windCount++; }
      const p = row.models[mp.id]?.precipitation_probability;
      if (p !== undefined && p !== null) { precipSum += Number(p); precipCount++; }
    }
  }
  const parts = [];
  if (tempCount > 0) {
    const avg = Math.round(tempSum / tempCount);
    parts.push(`${avg}°C`);
  }
  if (cloudCount > 0) {
    const avg = cloudSum / cloudCount;
    if (avg < 30) parts.push('clear');
    else if (avg <= 70) parts.push('partly cloudy');
    else parts.push('cloudy');
  }
  if (windCount > 0) {
    const avg = windSum / windCount;
    if (avg < 15) parts.push('light wind');
    else if (avg <= 30) parts.push('moderate wind');
    else parts.push('strong wind');
  }
  if (precipCount > 0) {
    const avg = precipSum / precipCount;
    if (avg >= 50) parts.push('rain likely');
  }
  return parts.join(' \u00b7 ');
}

function buildVerdictBanner(verdict, summary) {
  const banner = document.getElementById('verdict-banner');
  const iconEl = document.getElementById('verdict-icon');
  const textEl = document.getElementById('verdict-text');
  const summaryEl = document.getElementById('verdict-summary');
  banner.className = 'verdict-banner ' + verdict.cssClass;
  iconEl.innerHTML = verdict.icon ? renderVerdictIcon(verdict.icon) : '';
  textEl.textContent = verdict.text;
  summaryEl.textContent = summary || '';
  banner.classList.remove('hidden');
}

/* ── Period summary ── */

function buildPeriodSummary(filtered, visibleModels, aggr) {
  const container = document.getElementById('period-summary');
  container.innerHTML = '';

  const periods = [
    { name: 'Morning', start: 6, end: 11 },
    { name: 'Afternoon', start: 12, end: 17 },
    { name: 'Evening', start: 18, end: 22 },
  ];

  for (const p of periods) {
    const pRows = [];
    const pIndices = [];
    for (let i = 0; i < filtered.length; i++) {
      if (filtered[i].hour >= p.start && filtered[i].hour <= p.end) {
        pRows.push(filtered[i]);
        pIndices.push(i);
      }
    }
    if (!pIndices.length) continue;
    const rangeLabel = pRows.length > 1 ? `${pRows[0].hour}\u2013${pRows[pRows.length - 1].hour}` : `${pRows[0].hour}`;
    p.label = `${p.name} (${rangeLabel})`;

    let dry = 0, wet = 0, split = 0, totalH = 0;
    let totalDry = 0, totalUnc = 0, totalWet = 0;
    for (const idx of pIndices) {
      const a = aggr[idx];
      if (!a || a.total === 0) continue;
      totalH++;
      totalDry += a.dry; totalUnc += a.uncertain; totalWet += a.wet;
      const dryPct = a.dry / a.total;
      const wetPct = a.wet / a.total;
      if (dryPct >= AGREEMENT_THRESHOLD) dry++;
      else if (wetPct >= AGREEMENT_THRESHOLD) wet++;
      else split++;
    }

    const totalRatings = totalDry + totalUnc + totalWet;
    const distParts = [];
    if (totalDry > 0) distParts.push(`${totalDry}/${totalRatings} dry`);
    if (totalUnc > 0) distParts.push(`${totalUnc}/${totalRatings} mixed`);
    if (totalWet > 0) distParts.push(`${totalWet}/${totalRatings} wet`);
    const distText = distParts.join(' \u00b7 ');

    let statusText, statusClass;
    if (totalH === 0) {
      statusText = 'No data'; statusClass = 'period-nodata';
    } else if (dry >= wet && dry >= split) {
      statusText = 'Dry'; statusClass = 'period-dry';
    } else if (wet >= dry && wet >= split) {
      statusText = 'Rain likely'; statusClass = 'period-wet';
    } else {
      statusText = 'Mixed signals'; statusClass = 'period-split';
    }

    const modelBreakdown = visibleModels.map(mp => {
      let dryH = 0, uncH = 0, wetH = 0;
      for (const row of pRows) {
        const val = row.models[mp.id]?.precipitation_probability;
        if (val === undefined) continue;
        const c = classifyPrecip(val);
        if (c === 'dry') dryH++;
        else if (c === 'mixed') uncH++;
        else if (c === 'wet') wetH++;
      }
    const mDef = MODEL_LOOKUP.get(mp.id);
    return { modelId: mp.id, short: mDef ? mDef.short : mp.id.slice(0, 4), label: mDef ? mDef.label : mp.id, dry: dryH, uncertain: uncH, wet: wetH };
    });

    let detailHTML = '';
    for (const mb of modelBreakdown) {
      const bits = [];
      const mbTotal = mb.dry + mb.uncertain + mb.wet;
      if (mb.dry > 0) bits.push(`<span class="mb-dry">${mb.dry}/${mbTotal} dry</span>`);
      if (mb.uncertain > 0) bits.push(`<span class="mb-unc">${mb.uncertain}/${mbTotal} mixed</span>`);
      if (mb.wet > 0) bits.push(`<span class="mb-wet">${mb.wet}/${mbTotal} wet</span>`);
      if (!bits.length) bits.push('<span class="mb-missing">no data</span>');
      detailHTML += `<div class="mb-row"><span class="mb-label" title="${mb.label}">${mb.short}</span> ${bits.join(' \u00b7 ')}</div>`;
    }

    let ensAvg = null;
    if (pRows.length > 0) {
      let sum = 0, count = 0;
      for (const row of pRows) {
        for (const mp of visibleModels) {
          const val = row.models[mp.id]?.precipitation_probability;
          if (val !== undefined && val !== null) { sum += Number(val); count++; }
        }
      }
      if (count > 0) ensAvg = sum / count;
    }

    const block = document.createElement('div');
    block.className = 'period-block ' + statusClass;
    let agreeHtml = `<div class="period-agree">${distText}</div>`;
    if (ensAvg !== null) {
      const barW = Math.round(ensAvg);
      agreeHtml += `<div class="period-ensemble"><span class="ensemble-bar-wrap"><span class="ensemble-bar" style="width:${barW}%"></span></span> <span class="ensemble-label">${barW}% average precipitation probability (${visibleModels.length} models)</span></div>`;
    }
    block.innerHTML = `<div class="period-bar"></div>
      <div class="period-label">${p.label}</div>
      <div class="period-status">${statusText}</div>
      ${agreeHtml}
      <div class="period-detail">${detailHTML}</div>`;
    block.tabIndex = 0;
    block.setAttribute('role', 'button');
    block.setAttribute('aria-expanded', 'false');
    block.addEventListener('click', function () { this.classList.toggle('period-expanded'); this.setAttribute('aria-expanded', this.classList.contains('period-expanded')); });
    block.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.classList.toggle('period-expanded'); this.setAttribute('aria-expanded', this.classList.contains('period-expanded')); } });
    container.appendChild(block);
  }
}

/* ── Hour strip ── */

function buildHourStrip(filtered, visibleModels, aggr) {
  const strip = document.getElementById('hour-strip');
  strip.innerHTML = '';
  for (let i = 0; i < filtered.length; i++) {
    const block = document.createElement('div');
    block.className = 'hour-block';
    block.tabIndex = 0;
    block.setAttribute('role', 'img');
    const a = aggr[i];
    if (a.total === 0) {
      block.className += ' hour-nodata';
      block.innerHTML = `<div class="hour-block-label">${formatHour(filtered[i].hour)}</div><div class="hour-block-val">\u2014</div>`;
      block.setAttribute('aria-label', `${formatHour(filtered[i].hour)}: no data`);
    } else {
      const dryPct = a.dry / a.total;
      const wetPct = a.wet / a.total;
      let label;
      if (dryPct >= AGREEMENT_THRESHOLD) { block.className += ' hour-dry'; label = 'dry'; }
      else if (wetPct >= AGREEMENT_THRESHOLD) { block.className += ' hour-wet'; label = 'wet'; }
      else { block.className += ' hour-split'; label = 'mixed'; }
      block.innerHTML = `<div class="hour-block-label">${formatHour(filtered[i].hour)}</div><div class="hour-block-val">${a.dry}/${a.total}</div>`;
      block.setAttribute('aria-label', `${formatHour(filtered[i].hour)}: ${a.dry}/${a.total} models agree ${label}`);
    }
    strip.appendChild(block);
  }
}

/* ── Date picker ── */

function initDatePicker() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minStr = dateStr(today);
  const maxStr = dateStr(addDays(today, 6));
  selectDay.min = minStr;
  selectDay.max = maxStr;
  const saved = storage.get('weather_date');
  if (saved && saved >= minStr && saved <= maxStr) {
    selectDay.value = saved;
  } else if (!saved || saved < minStr || saved > maxStr) {
    const def = getNextSaturday();
    def.setHours(0, 0, 0, 0);
    selectDay.value = dateStr(def);
  }
}

function handleDateChange() {
  if (!lastRawData) return;
  const dateVal = selectDay.value;
  if (!dateVal) return;
  tablesContainer.innerHTML = '<p class="no-data">Updating\u2026</p>';
  try {
    const parts = dateVal.split('-').map(Number);
    const selected = new Date(parts[0], parts[1] - 1, parts[2]);
    lastSelectedDate = selected;
    const { rows, modelsPresent } = parseHourly(lastRawData, MODELS, selected);
    lastRows = rows;
    lastModels = modelsPresent;
    const sunTimes = getSunTimes(lastRawData, selected);
    lastSunrise = sunTimes?.sunrise ?? null;
    lastSunset = sunTimes?.sunset ?? null;
    storage.set('weather_date', dateVal);
    showResults(selected, rows, modelsPresent, parseInt(hourStart.value, 10), parseInt(hourEnd.value, 10));
  } catch {
    showError('Could not update forecast for this date.');
  }
}

/* ── UI state ── */

function showLoading() {
  loadingEl.classList.remove('hidden');
  errorEl.classList.add('hidden');
  checkBtn.disabled = true;
}

function hideLoading() {
  loadingEl.classList.add('hidden');
  checkBtn.disabled = false;
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  hideLoading();
}

function showResults(selectedDate, rows, modelsPresent, startH, endH) {
  forecastHeading.textContent = formatDateLong(selectedDate);
  const sunEl = document.getElementById('sun-info');
  sunEl.classList.add('hidden');
  if (lastSunrise && lastSunset) {
    sunEl.innerHTML = `<span class="visually-hidden">Sunrise </span>\u2600 ${lastSunrise}<br><span class="visually-hidden">Sunset </span>\u2601 ${lastSunset}`;
    sunEl.classList.remove('hidden');
  } else {
    sunEl.classList.add('hidden');
  }

  const filtered = filterHours(rows, startH, endH);
  const visibleModels = modelsPresent.filter(m => m.present);
  const aggr = hourlyAgreement(filtered, visibleModels);

  const verdict = getVerdict(filtered, visibleModels, aggr);
  const summary = buildConsensusSummary(filtered, visibleModels);
  buildVerdictBanner(verdict, summary);

  buildPeriodSummary(filtered, visibleModels, aggr);
  buildHourStrip(filtered, visibleModels, aggr);
  buildTables(rows, modelsPresent, startH, endH, filtered, aggr);

  resultsSection.classList.remove('hidden');
  errorEl.classList.add('hidden');
  forecastHeading.tabIndex = -1;
  forecastHeading.focus();
}

/* ── Hour range init ── */

function initHourRange() {
  hourStart.innerHTML = '';
  hourEnd.innerHTML = '';
  for (let h = 0; h <= 23; h++) {
    const optS = document.createElement('option');
    const optE = document.createElement('option');
    const label = `${h.toString().padStart(2, '0')}:00`;
    optS.value = h; optS.textContent = label;
    optE.value = h; optE.textContent = label;
    hourStart.appendChild(optS);
    hourEnd.appendChild(optE);
  }
  hourStart.value = DEFAULT_START;
  hourEnd.value = DEFAULT_END;
}

/* ── Main handler ── */

async function handleSubmit(e) {
  const raw = input.value.trim();
  if (!raw) { e.preventDefault(); return; }
  e.preventDefault();

  showLoading();
  resultsSection.classList.add('hidden');
  const token = ++requestToken;

  try {
    const { lat, lon } = await geocode(raw);
    if (token !== requestToken) { hideLoading(); return; }
    const forecastRes = await fetchForecast(lat, lon);
    if (token !== requestToken) { hideLoading(); return; }
    lastRawData = forecastRes;
    storage.set('weather_postcode', input.value.trim().toUpperCase());
    if (!selectDay.min) initDatePicker();
    handleDateChange();
  } catch (err) {
    if (token !== requestToken) { hideLoading(); return; }
    showError(err.message || 'Something went wrong. Try again.');
    return;
  }

  hideLoading();
}

function showRangeHint() {
  rangeHint.textContent = 'End set to match start';
  rangeHint.classList.remove('hidden');
  clearTimeout(rangeHint._timer);
  rangeHint._timer = setTimeout(() => rangeHint.classList.add('hidden'), 2500);
}

function handleRangeChange() {
  if (!lastRows || !lastModels) return;
  let startH = parseInt(hourStart.value, 10);
  let endH = parseInt(hourEnd.value, 10);
  if (endH < startH) { endH = startH; hourEnd.value = startH; showRangeHint(); }
  storage.set('weather_hour_start', startH);
  storage.set('weather_hour_end', endH);
  showResults(lastSelectedDate, lastRows, lastModels, startH, endH);
}

/* ── Bootstrap ── */

initHourRange();
initDatePicker();
input.addEventListener('input', function () { this.value = this.value.replace(/\s/g, ''); });
form.addEventListener('submit', handleSubmit);
updateBtn.addEventListener('click', handleDateChange);
locateBtn.addEventListener('click', handleUseLocation);
hourStart.addEventListener('change', handleRangeChange);
hourEnd.addEventListener('change', handleRangeChange);

/* ── Restore saved state ── */

const savedStart = storage.get('weather_hour_start');
const savedEnd = storage.get('weather_hour_end');
if (savedStart) hourStart.value = savedStart;
if (savedEnd) hourEnd.value = savedEnd;
const savedPostcode = storage.get('weather_postcode');
if (savedPostcode) {
  input.value = savedPostcode;
  try { form.requestSubmit(); } catch {}
}

/* ── Service worker ── */

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
}
