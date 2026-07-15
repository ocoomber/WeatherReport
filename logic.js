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

function getCleanPostcode(raw) {
  return raw.replace(/\s/g, '').toUpperCase();
}

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

function getTableData(filtered, modelsPresent, agreement) {
  const visibleModels = modelsPresent.filter(m => m.present);
  if (!visibleModels.length || !filtered.length) return null;
  const modelDayAgree = modelDayAgreement(filtered, visibleModels);
  const metrics = [];

  for (const metric of METRICS) {
    const metricModels = visibleModels.filter(mp => filtered.some(r => r.models[mp.id]?.[metric.key] !== undefined));
    if (!metricModels.length) continue;

    const headerCells = [
      { text: 'Time' },
      ...metricModels.map(mp => {
        const mDef = MODEL_LOOKUP.get(mp.id);
        return { text: mDef ? mDef.short : mp.id.slice(0, 4), title: mDef ? mDef.label : mp.id, className: 'model-label' };
      }),
      ...(metric.key === 'precipitation_probability' ? [{ text: 'Agree' }] : [])
    ];

    const rows = filtered.map((row, ri) => {
      const cells = [{ text: formatHour(row.hour) }];
      for (const mp of metricModels) {
        const val = row.models[mp.id]?.[metric.key];
        if (val === undefined) {
          cells.push({ text: '\u2014', className: 'cell-missing' });
        } else {
          const clazz = classifyCell(metric.key, val);
          const decimals = metric.key === 'precipitation' || metric.key === 'wind_speed_10m' || metric.key === 'wind_gusts_10m' || metric.key === 'temperature_2m' ? 1 : 0;
          cells.push({ text: fmt(val, '', decimals), className: clazz ? 'cell-' + clazz : '' });
        }
      }
      if (metric.key === 'precipitation_probability') {
        const a = agreement[ri];
        if (a.total === 0) {
          cells.push({ text: '\u2014', className: 'agreement-col' });
        } else {
          const pct = Math.round((a.dry / a.total) * 100);
          if (a.wet >= a.total * AGREEMENT_THRESHOLD) {
            cells.push({ text: `${a.wet}/${a.total}`, className: 'agreement-col low' });
          } else {
            cells.push({ text: `${a.dry}/${a.total}`, className: `agreement-col${pct >= 80 ? ' high' : ' medium'}` });
          }
        }
      }
      return { cells };
    });

    let agreementRow = null;
    if (metric.key === 'precipitation_probability') {
      const cells = [{ text: 'Dry hours' }];
      for (const mp of metricModels) {
        const md = modelDayAgree.find(a => a.modelId === mp.id);
        if (md && md.total > 0) {
          cells.push({ text: `${md.dry}/${md.total}`, className: md.dry / md.total >= AGREEMENT_THRESHOLD ? 'model-agree-dry' : 'model-agree-other' });
        } else {
          cells.push({ text: '\u2014', className: 'cell-missing' });
        }
      }
      cells.push({ text: '' });
      agreementRow = { cells };
    }

    metrics.push({ metric, headerCells, rows, agreementRow });
  }
  return metrics;
}

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

function getPeriodData(filtered, visibleModels, aggr) {
  const defs = [
    { name: 'Morning', start: 6, end: 11 },
    { name: 'Afternoon', start: 12, end: 17 },
    { name: 'Evening', start: 18, end: 22 },
  ];

  return defs.map(p => {
    const pRows = [];
    const pIndices = [];
    for (let i = 0; i < filtered.length; i++) {
      if (filtered[i].hour >= p.start && filtered[i].hour <= p.end) {
        pRows.push(filtered[i]);
        pIndices.push(i);
      }
    }
    if (!pIndices.length) return null;
    const rangeLabel = pRows.length > 1 ? `${pRows[0].hour}\u2013${pRows[pRows.length - 1].hour}` : `${pRows[0].hour}`;
    const label = `${p.name} (${rangeLabel})`;

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

    return { label, statusText, statusClass, distText, ensAvg, modelCount: visibleModels.length, detailHTML };
  }).filter(Boolean);
}

function getHourStripData(filtered, aggr) {
  return filtered.map((row, i) => {
    const a = aggr[i];
    const hour = formatHour(row.hour);
    if (a.total === 0) {
      return { hour, agreement: '\u2014', className: 'hour-nodata', ariaLabel: `${hour}: no data` };
    }
    const dryPct = a.dry / a.total;
    const wetPct = a.wet / a.total;
    let label, className;
    if (dryPct >= AGREEMENT_THRESHOLD) { className = 'hour-dry'; label = 'dry'; }
    else if (wetPct >= AGREEMENT_THRESHOLD) { className = 'hour-wet'; label = 'wet'; }
    else { className = 'hour-split'; label = 'mixed'; }
    return { hour, agreement: `${a.dry}/${a.total}`, className, ariaLabel: `${hour}: ${a.dry}/${a.total} models agree ${label}` };
  });
}
