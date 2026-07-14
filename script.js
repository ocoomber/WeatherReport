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
];

const ENSEMBLE_MODELS = [
  { id: 'ecmwf_ifs025', short: 'ECMWF', label: 'ECMWF IFS ENS (51 members)' },
  { id: 'gfs_seamless', short: 'GFS', label: 'NOAA GFS ENS (31 members)' },
  { id: 'icon_seamless', short: 'ICON', label: 'DWD ICON EPS (40 members)' },
  { id: 'gem_seamless', short: 'GEM', label: 'Env. Canada GEM EPS (21 members)' },
];

const DEFAULT_START = 6;
const DEFAULT_END = 22;

/* ── DOM refs ── */

const form = document.getElementById('search-form');
const input = document.getElementById('postcode-input');
const checkBtn = document.getElementById('check-btn');
const loadingEl = document.getElementById('loading-indicator');
const errorEl = document.getElementById('error-display');
const resultsSection = document.getElementById('results-section');
const forecastHeading = document.getElementById('forecast-heading');
const summaryLineEl = document.getElementById('summary-line');
const tablesContainer = document.getElementById('tables-container');
const hourStart = document.getElementById('hour-start');
const hourEnd = document.getElementById('hour-end');
const selectDay = document.getElementById('forecast-date');
const updateBtn = document.getElementById('update-btn');

/* ── Helpers ── */

function fmt(val, unit, decimals) {
  if (val === null || val === undefined || val === '') return '\u2014';
  const n = Number(val);
  if (isNaN(n)) return '\u2014';
  return n.toFixed(decimals ?? (Number.isInteger(n) ? 0 : 1)) + (unit ? unit : '');
}

function formatHour(h) {
  const h24 = Number(h);
  if (h24 === 0) return '12am';
  if (h24 < 12) return h24 + 'am';
  if (h24 === 12) return '12pm';
  return (h24 - 12) + 'pm';
}

function normalisePostcode(pc) {
  if (!pc || typeof pc !== 'string') return '';
  const s = pc.trim().toUpperCase().replace(/\s+/g, '');
  if (s.length < 5 || s.length > 7) return '';
  return s;
}

/* ── State ── */

let lastRawData = null;
let lastEnsembleData = null;
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

function getNextSaturday() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 6 ? 0 : (6 - day + 7) % 7;
  return addDays(now, diff);
}

/* ── API calls ── */

async function geocode(postcode) {
  const pc = normalisePostcode(postcode);
  if (!pc) throw new Error('Enter a valid UK postcode (e.g. SW1A 1AA).');
  const url = `https://api.postcodes.io/postcodes/${pc}`;
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`Postcode "${input.value.trim().toUpperCase()}" not found. Check it and try again.`);
  if (!res.ok) throw new Error(`Geocoding failed (HTTP ${res.status}). Try again.`);
  const body = await res.json();
  if (!body || !body.result) throw new Error('Unexpected response from postcodes.io.');
  return { lat: body.result.latitude, lon: body.result.longitude };
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
    forecast_days: '7',
    timezone: 'Europe/London',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast failed (HTTP ${res.status}). Try again.`);
  const body = await res.json();
  if (body.error) throw new Error(body.reason || 'Weather service returned an error.');
  return body;
}

async function fetchEnsemble(lat, lon) {
  const modelIds = ENSEMBLE_MODELS.map(m => m.id).join(',');
  const url = 'https://api.open-meteo.com/v1/ensemble?' + new URLSearchParams({
    latitude: lat,
    longitude: lon,
    hourly: 'precipitation,wind_speed_10m,wind_gusts_10m,cloud_cover',
    models: modelIds,
    forecast_days: '7',
    timezone: 'Europe/London',
  });
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  if (body.error) return null;
  return body;
}

function getSunTimes(rawData, selectedDate) {
  if (!rawData || !rawData.daily) return null;
  const target = dateStr(selectedDate);
  for (let i = 0; i < rawData.daily.time.length; i++) {
    if (rawData.daily.time[i] !== target) continue;
    const keys = Object.keys(rawData.daily);
    const sunriseKey = keys.find(k => k.startsWith('sunrise_'));
    const sunsetKey = keys.find(k => k.startsWith('sunset_'));
    if (!sunriseKey || !sunsetKey) return null;
    const sunrise = rawData.daily[sunriseKey]?.[i];
    const sunset = rawData.daily[sunsetKey]?.[i];
    if (sunrise && sunset) {
      const fmtTime = (iso) => iso.slice(11, 16);
      return { sunrise: fmtTime(sunrise), sunset: fmtTime(sunset) };
    }
    return null;
  }
  return null;
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
  if (val <= 50) return 'uncertain';
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
      else if (c === 'uncertain') uncertain++;
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

/* ── Summary generation ── */

function generateSummary(rows, modelsPresent) {
  if (!rows.length || !modelsPresent.length) return 'No forecast data available for this date.';

  const visibleModels = modelsPresent.filter(m => m.present);
  const numModels = visibleModels.length;
  if (numModels === 0) return 'No model data returned for the selected hours.';

  const aggr = hourlyAgreement(rows, visibleModels);
  if (!aggr.length) return 'No data for the selected hours.';

  const dryHours = aggr.filter(a => a.total > 0 && a.dry >= a.total * 0.6);
  const wetHours = aggr.filter(a => a.total > 0 && a.wet >= a.total * 0.6);
  const splitHours = aggr.filter(a => a.total > 0 && a.dry < a.total * 0.6 && a.wet < a.total * 0.6);

  if (dryHours.length === rows.length) {
    return `All ${numModels} models agree: dry conditions throughout the day. High confidence.`;
  }
  if (wetHours.length === rows.length) {
    return `All ${numModels} models agree: rain expected throughout the day. High confidence.`;
  }

  if (splitHours.length > rows.length * 0.5) {
    return `Low confidence — models disagree on rain risk for most of the day. Check again closer to the date.`;
  }

  const parts = [];
  let i = 0;
  while (i < rows.length) {
    const a = aggr[i];
    let j = i;
    const state = a.total > 0 && a.dry >= a.total * 0.6 ? 'dry' : (a.total > 0 && a.wet >= a.total * 0.6 ? 'wet' : 'split');
    while (j < rows.length) {
      const aj = aggr[j];
      const sj = aj.total > 0 && aj.dry >= aj.total * 0.6 ? 'dry' : (aj.total > 0 && aj.wet >= aj.total * 0.6 ? 'wet' : 'split');
      if (sj !== state) break;
      j++;
    }
    const startLabel = formatHour(rows[i].hour);
    const endLabel = formatHour(rows[j - 1].hour);
    if (state === 'dry') parts.push(`dry until ${endLabel}`);
    else if (state === 'wet') parts.push(`rain from ${startLabel}`);
    else parts.push(`uncertain around ${startLabel}`);
    i = j;
  }

  const maxAgreePct = Math.max(...aggr.map(a => a.total > 0 ? a.dry / a.total : 0));
  const agreementLevel = maxAgreePct >= 0.8 ? 'strong agreement' : (maxAgreePct >= 0.6 ? 'moderate agreement' : 'low confidence');

  const summary = parts.join('; ');
  return `${numModels} of ${MODELS.length} models available. ${summary}. ${agreementLevel.charAt(0).toUpperCase() + agreementLevel.slice(1)}.`;
}

/* ── Ensemble helpers ── */

function getEnsembleSpread(metricKey, hour, ensembleData, selectedDate) {
  if (!ensembleData || !ensembleData.hourly) return null;
  const times = ensembleData.hourly.time;
  const ds = dateStr(selectedDate);
  const target = `${ds}T${String(hour).padStart(2, '0')}:00`;
  const idx = times.indexOf(target);
  if (idx === -1) return null;

  const metricKEYS = { precipitation: 'precipitation', wind_speed_10m: 'wind_speed_10m', wind_gusts_10m: 'wind_gusts_10m', cloud_cover: 'cloud_cover' };
  const base = metricKEYS[metricKey];
  if (!base) return null;

  let p10Sum = 0, p90Sum = 0, count = 0;
  for (const m of ENSEMBLE_MODELS) {
    const p10Key = `${base}_${m.id}_p10`;
    const p90Key = `${base}_${m.id}_p90`;
    const p10 = ensembleData.hourly[p10Key]?.[idx];
    const p90 = ensembleData.hourly[p90Key]?.[idx];
    if (p10 !== undefined && p10 !== null && p90 !== undefined && p90 !== null) {
      p10Sum += p10; p90Sum += p90; count++;
    }
  }
  if (count === 0) return null;
  return { p10: p10Sum / count, p90: p90Sum / count };
}

/* ── Table builder ── */

function buildTables(rows, modelsPresent, startH, endH) {
  tablesContainer.innerHTML = '';
  const filtered = filterHours(rows, startH, endH);
  if (!filtered.length) {
    tablesContainer.innerHTML = '<p class="no-data">No data for the selected hour range.</p>';
    return;
  }

  const visibleModels = modelsPresent.filter(m => m.present);
  if (!visibleModels.length) {
    tablesContainer.innerHTML = '<p class="no-data">No model data returned. Try a different postcode or come back later.</p>';
    return;
  }

  const agreement = hourlyAgreement(filtered, visibleModels);
  const modelDayAgree = modelDayAgreement(filtered, visibleModels);

  for (const metric of METRICS) {
    const section = document.createElement('section');
    section.className = 'metric-section';

    const header = document.createElement('div');
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
    for (const mp of visibleModels) {
      const th = document.createElement('th');
      const mDef = MODELS.find(m => m.id === mp.id);
      th.textContent = mDef ? mDef.short : mp.id.slice(0, 4);
      th.title = mDef ? mDef.label : mp.id;
      th.className = 'model-label';
      headRow.appendChild(th);
    }
    const agreeTh = document.createElement('th');
    agreeTh.textContent = 'Agreement';
    headRow.appendChild(agreeTh);
    const rangeTh = document.createElement('th');
    rangeTh.textContent = 'Range';
    rangeTh.className = 'range-col';
    headRow.appendChild(rangeTh);
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

      for (const mp of visibleModels) {
        const td = document.createElement('td');
        const val = row.models[mp.id]?.[metric.key];
        if (val === undefined) {
          td.textContent = '\u2014';
          td.className = 'cell-missing';
        } else {
          const clazz = classifyCell(metric.key, val);
          if (clazz) td.className = 'cell-' + clazz;
          const decimals = metric.key === 'precipitation' || metric.key === 'wind_speed_10m' || metric.key === 'wind_gusts_10m' ? 1 : 0;
          td.textContent = fmt(val, '', decimals);
        }
        tr.appendChild(td);
      }

      /* Agreement column */
      const aTd = document.createElement('td');
      aTd.className = 'agreement-col';
      const a = agreement[ri];
      if (a.total === 0) {
        aTd.textContent = '\u2014';
      } else {
        const pct = Math.round((a.dry / a.total) * 100);
        if (pct >= 80) { aTd.textContent = `${a.dry}/${a.total} dry`; aTd.className += ' high'; }
        else if (pct >= 50) { aTd.textContent = `${a.dry}/${a.total} dry`; aTd.className += ' medium'; }
        else if (a.wet >= a.total * 0.5) { aTd.textContent = `${a.wet}/${a.total} wet`; aTd.className += ' low'; }
        else { aTd.textContent = `Split`; aTd.className += ' medium'; }
      }
      tr.appendChild(aTd);

      /* Range column */
      const rTd = document.createElement('td');
      rTd.className = 'range-col';
      const spread = getEnsembleSpread(metric.key, row.hour, lastEnsembleData, lastSelectedDate);
      if (spread) {
        const decimals = metric.key === 'precipitation' ? 1 : 0;
        rTd.textContent = `${fmt(spread.p10, '', decimals)}\u2013${fmt(spread.p90, '', decimals)}`;
      } else {
        rTd.textContent = '\u2014';
        rTd.className += ' cell-missing';
      }
      tr.appendChild(rTd);

      tbody.appendChild(tr);
    }

    /* Agreement row at bottom */
    const agreeTr = document.createElement('tr');
    agreeTr.className = 'agreement-row';
    const labelTd = document.createElement('td');
    labelTd.textContent = 'Dry hours';
    agreeTr.appendChild(labelTd);

    for (const mp of visibleModels) {
      const td = document.createElement('td');
      const md = modelDayAgree.find(a => a.modelId === mp.id);
      if (md && md.total > 0) {
        td.textContent = `${md.dry}/${md.total}`;
        td.className = md.dry / md.total >= 0.6 ? 'model-agree-dry' : 'model-agree-wet';
      } else {
        td.textContent = '\u2014';
        td.className = 'cell-missing';
      }
      agreeTr.appendChild(td);
    }

    const emptyAgreeTd = document.createElement('td');
    agreeTr.appendChild(emptyAgreeTd);
    const emptyRangeTd = document.createElement('td');
    emptyRangeTd.className = 'range-col';
    agreeTr.appendChild(emptyRangeTd);
    tbody.appendChild(agreeTr);

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
    if (dryPct >= 0.6) dry++;
    else if (wetPct >= 0.6) wet++;
    else split++;
  }
  const total = dry + wet + split;
  if (total === 0) return { id: 'nodata', text: 'Insufficient data', cssClass: 'verdict-nodata' };
  const dryPct = dry / total;
  const wetPct = wet / total;
  if (dryPct >= 0.65) return { id: 'outdoor', text: 'Outdoor looks good', cssClass: 'verdict-outdoor', icon: 'sun' };
  if (wetPct >= 0.65) return { id: 'indoor', text: 'Indoor suggested', cssClass: 'verdict-indoor', icon: 'rain' };
  return { id: 'uncertain', text: 'Too close to call \u2014 check again tomorrow', cssClass: 'verdict-uncertain', icon: 'cloud' };
}

function renderVerdictIcon(iconId) {
  if (iconId === 'sun') return '<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.5 4.5l2 2M17.5 17.5l2 2M4.5 19.5l2-2M17.5 6.5l2-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  if (iconId === 'rain') return '<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 14c0-6 18-6 18 0" stroke="currentColor" stroke-width="2" fill="currentColor" opacity="0.25"/><path d="M7 18l-1 3M12 18l-1 3M17 18l-1 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  if (iconId === 'cloud') return '<svg viewBox="0 0 24 24" width="28" height="28" fill="none"><path d="M3 14c0-6 18-6 18 0" stroke="currentColor" stroke-width="2" fill="currentColor" opacity="0.25"/><path d="M5 16c0-4 14-4 14 0" stroke="currentColor" stroke-width="1.5" fill="currentColor" opacity="0.15"/><path d="M8 18h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  return '';
}

function buildVerdictBanner(verdict) {
  const banner = document.getElementById('verdict-banner');
  const iconEl = document.getElementById('verdict-icon');
  const textEl = document.getElementById('verdict-text');
  banner.className = 'verdict-banner ' + verdict.cssClass;
  iconEl.innerHTML = verdict.icon ? renderVerdictIcon(verdict.icon) : '';
  textEl.textContent = verdict.text;
  banner.classList.remove('hidden');
}

/* ── Period summary ── */

function buildPeriodSummary(filtered, visibleModels, aggr) {
  const container = document.getElementById('period-summary');
  container.innerHTML = '';

  const periods = [
    { label: 'Morning (6-11)', start: 6, end: 11 },
    { label: 'Afternoon (12-17)', start: 12, end: 17 },
    { label: 'Evening (18-22)', start: 18, end: 22 },
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

    let dry = 0, wet = 0, split = 0, totalH = 0;
    let totalDry = 0, totalUnc = 0, totalWet = 0;
    for (const idx of pIndices) {
      const a = aggr[idx];
      if (!a || a.total === 0) continue;
      totalH++;
      totalDry += a.dry; totalUnc += a.uncertain; totalWet += a.wet;
      const dryPct = a.dry / a.total;
      const wetPct = a.wet / a.total;
      if (dryPct >= 0.6) dry++;
      else if (wetPct >= 0.6) wet++;
      else split++;
    }

    const distParts = [];
    if (totalDry > 0) distParts.push(`${totalDry} dry`);
    if (totalUnc > 0) distParts.push(`${totalUnc} uncertain`);
    if (totalWet > 0) distParts.push(`${totalWet} wet`);
    const distText = distParts.join(' \u00b7 ');

    let status, statusText, statusClass;
    if (totalH === 0) {
      status = 'nodata'; statusText = 'No data'; statusClass = 'period-nodata';
    } else if (dry >= wet && dry >= split) {
      status = 'dry'; statusText = 'Dry'; statusClass = 'period-dry';
    } else if (wet >= dry && wet >= split) {
      status = 'wet'; statusText = 'Rain likely'; statusClass = 'period-wet';
    } else {
      status = 'split'; statusText = 'Mixed signals'; statusClass = 'period-split';
    }

    const modelBreakdown = visibleModels.map(mp => {
      let dryH = 0, uncH = 0, wetH = 0;
      for (const row of pRows) {
        const val = row.models[mp.id]?.precipitation_probability;
        if (val === undefined) continue;
        const c = classifyPrecip(val);
        if (c === 'dry') dryH++;
        else if (c === 'uncertain') uncH++;
        else if (c === 'wet') wetH++;
      }
      const mDef = MODELS.find(m => m.id === mp.id);
      return { modelId: mp.id, short: mDef ? mDef.short : mp.id.slice(0, 4), label: mDef ? mDef.label : mp.id, dry: dryH, uncertain: uncH, wet: wetH };
    });

    let detailHTML = '';
    for (const mb of modelBreakdown) {
      const bits = [];
      if (mb.dry > 0) bits.push(`<span class="mb-dry">${mb.dry} dry</span>`);
      if (mb.uncertain > 0) bits.push(`<span class="mb-unc">${mb.uncertain} uncertain</span>`);
      if (mb.wet > 0) bits.push(`<span class="mb-wet">${mb.wet} wet</span>`);
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
      agreeHtml += `<div class="period-ensemble"><span class="ensemble-bar-wrap"><span class="ensemble-bar" style="width:${barW}%"></span></span> <span class="ensemble-label">${barW}% average rain risk (${visibleModels.length} models)</span></div>`;
    }
    block.innerHTML = `<div class="period-bar"></div>
      <div class="period-label">${p.label}</div>
      <div class="period-status">${statusText}</div>
      ${agreeHtml}
      <div class="period-detail">${detailHTML}</div>`;
    block.addEventListener('click', function () { this.classList.toggle('period-expanded'); });
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
    const a = aggr[i];
    if (a.total === 0) {
      block.className += ' hour-nodata';
      block.innerHTML = `<div class="hour-block-label">${formatHour(filtered[i].hour)}</div><div class="hour-block-val">\u2014</div>`;
    } else {
      const dryPct = a.dry / a.total;
      const wetPct = a.wet / a.total;
      if (dryPct >= 0.6) block.className += ' hour-dry';
      else if (wetPct >= 0.6) block.className += ' hour-wet';
      else block.className += ' hour-split';
      block.innerHTML = `<div class="hour-block-label">${formatHour(filtered[i].hour)}</div><div class="hour-block-val">${a.dry}/${a.total}</div>`;
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
  const def = getNextSaturday();
  def.setHours(0, 0, 0, 0);
  selectDay.value = dateStr(def);
}

function handleDateChange() {
  if (!lastRawData) return;
  const dateVal = selectDay.value;
  if (!dateVal) return;
  tablesContainer.innerHTML = '<p class="no-data">Updating\u2026</p>';
  const parts = dateVal.split('-').map(Number);
  const selected = new Date(parts[0], parts[1] - 1, parts[2]);
  lastSelectedDate = selected;
  const { rows, modelsPresent } = parseHourly(lastRawData, MODELS, selected);
  lastRows = rows;
  lastModels = modelsPresent;
  const sunTimes = getSunTimes(lastRawData, selected);
  lastSunrise = sunTimes?.sunrise ?? null;
  lastSunset = sunTimes?.sunset ?? null;
  localStorage.setItem('weather_date', dateVal);
  showResults(selected, rows, modelsPresent, parseInt(hourStart.value, 10), parseInt(hourEnd.value, 10));
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
  if (lastSunrise && lastSunset) {
    sunEl.innerHTML = `\u2600 Sunrise ${lastSunrise}<br>\u2601 Sunset ${lastSunset}`;
    sunEl.classList.remove('hidden');
  } else {
    sunEl.classList.add('hidden');
  }

  const filtered = filterHours(rows, startH, endH);
  const visibleModels = modelsPresent.filter(m => m.present);
  const aggr = hourlyAgreement(filtered, visibleModels);

  const verdict = getVerdict(filtered, visibleModels, aggr);
  buildVerdictBanner(verdict);

  const summary = generateSummary(filtered, modelsPresent);
  summaryLineEl.textContent = summary;
  summaryLineEl.classList.remove('hidden');

  buildPeriodSummary(filtered, visibleModels, aggr);
  buildHourStrip(filtered, visibleModels, aggr);
  buildTables(rows, modelsPresent, startH, endH);

  resultsSection.classList.remove('hidden');
  errorEl.classList.add('hidden');
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
  e.preventDefault();
  const raw = input.value.trim();
  if (!raw) return;

  showLoading();
  resultsSection.classList.add('hidden');
  const token = ++requestToken;

  try {
    const { lat, lon } = await geocode(raw);
    if (token !== requestToken) { hideLoading(); return; }
    const [forecastRes, ensembleRes] = await Promise.all([fetchForecast(lat, lon), fetchEnsemble(lat, lon)]);
    if (token !== requestToken) { hideLoading(); return; }
    lastRawData = forecastRes;
    lastEnsembleData = ensembleRes;
    localStorage.setItem('weather_postcode', input.value.trim().toUpperCase());
    initDatePicker();
    const restoredDate = localStorage.getItem('weather_date');
    if (restoredDate) selectDay.value = restoredDate;
    handleDateChange();
  } catch (err) {
    if (token !== requestToken) return;
    showError(err.message || 'Something went wrong. Try again.');
    return;
  }

  hideLoading();
}

function handleRangeChange() {
  if (!lastRows || !lastModels) return;
  let startH = parseInt(hourStart.value, 10);
  let endH = parseInt(hourEnd.value, 10);
  if (endH < startH) { endH = startH; hourEnd.value = startH; }
  localStorage.setItem('weather_hour_start', startH);
  localStorage.setItem('weather_hour_end', endH);
  showResults(lastSelectedDate, lastRows, lastModels, startH, endH);
}

/* ── Bootstrap ── */

initHourRange();
initDatePicker();
form.addEventListener('submit', handleSubmit);
updateBtn.addEventListener('click', handleDateChange);
hourStart.addEventListener('change', handleRangeChange);
hourEnd.addEventListener('change', handleRangeChange);

/* ── Restore saved state ── */

const savedStart = localStorage.getItem('weather_hour_start');
const savedEnd = localStorage.getItem('weather_hour_end');
if (savedStart) hourStart.value = savedStart;
if (savedEnd) hourEnd.value = savedEnd;
const savedDate = localStorage.getItem('weather_date');
if (savedDate) selectDay.value = savedDate;
const savedPostcode = localStorage.getItem('weather_postcode');
if (savedPostcode) {
  input.value = savedPostcode;
  form.requestSubmit();
}
