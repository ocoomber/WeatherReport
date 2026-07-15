function renderTables(metricTables) {
  tablesContainer.innerHTML = '';
  if (!metricTables) {
    tablesContainer.innerHTML = '<p class="no-data">No model data returned. Try a different postcode or come back later.</p>';
    return;
  }
  if (metricTables.length === 0) {
    tablesContainer.innerHTML = '<p class="no-data">No data for the selected hour range.</p>';
    return;
  }

  for (const { metric, headerCells, rows, agreementRow } of metricTables) {
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
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const h of headerCells) {
      const th = document.createElement('th');
      th.textContent = h.text;
      if (h.title) th.title = h.title;
      if (h.className) th.className = h.className;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const cell of row.cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    if (agreementRow) {
      const tr = document.createElement('tr');
      tr.className = 'agreement-row';
      for (const cell of agreementRow.cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.className) td.className = cell.className;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    section.appendChild(wrap);
    tablesContainer.appendChild(section);
  }
}

function renderVerdictBanner(verdict, summary) {
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

function renderPeriodSummary(periods) {
  const container = document.getElementById('period-summary');
  container.innerHTML = '';
  for (const p of periods) {
    const block = document.createElement('div');
    block.className = 'period-block ' + p.statusClass;
    let agreeHtml = `<div class="period-agree">${p.distText}</div>`;
    if (p.ensAvg !== null) {
      const barW = Math.round(p.ensAvg);
      agreeHtml += `<div class="period-ensemble"><span class="ensemble-bar-wrap"><span class="ensemble-bar" style="width:${barW}%"></span></span> <span class="ensemble-label">${barW}% average precipitation probability (${p.modelCount} models)</span></div>`;
    }
    block.innerHTML = `<div class="period-bar"></div>
      <div class="period-label">${p.label}</div>
      <div class="period-status">${p.statusText}</div>
      ${agreeHtml}
      <div class="period-detail">${p.detailHTML}</div>`;
    block.tabIndex = 0;
    block.setAttribute('role', 'button');
    block.setAttribute('aria-expanded', 'false');
    block.addEventListener('click', function () { this.classList.toggle('period-expanded'); this.setAttribute('aria-expanded', this.classList.contains('period-expanded')); });
    block.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.classList.toggle('period-expanded'); this.setAttribute('aria-expanded', this.classList.contains('period-expanded')); } });
    container.appendChild(block);
  }
}

function renderHourStrip(blocks) {
  const strip = document.getElementById('hour-strip');
  strip.innerHTML = '';
  for (const b of blocks) {
    const block = document.createElement('div');
    block.className = 'hour-block ' + b.className;
    block.tabIndex = 0;
    block.setAttribute('role', 'img');
    block.innerHTML = `<div class="hour-block-label">${b.hour}</div><div class="hour-block-val">${b.agreement}</div>`;
    block.setAttribute('aria-label', b.ariaLabel);
    strip.appendChild(block);
  }
}

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
  renderVerdictBanner(verdict, summary);

  renderPeriodSummary(getPeriodData(filtered, visibleModels, aggr));
  renderHourStrip(getHourStripData(filtered, aggr));
  renderTables(getTableData(filtered, modelsPresent, aggr));

  resultsSection.classList.remove('hidden');
  errorEl.classList.add('hidden');
  forecastHeading.tabIndex = -1;
  forecastHeading.focus();
}

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

function showRangeHint() {
  rangeHint.textContent = 'End set to match start';
  rangeHint.classList.remove('hidden');
  clearTimeout(rangeHint._timer);
  rangeHint._timer = setTimeout(() => rangeHint.classList.add('hidden'), 2500);
}
