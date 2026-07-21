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
    input.value = getCleanPostcode(pc);
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

function handleTodayClick() {
  selectDay.value = dateStr(new Date());
  storage.set('weather_date', selectDay.value);
  handleDateChange();
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
    storage.set('weather_postcode', getCleanPostcode(input.value));
    if (!selectDay.min) initDatePicker();
    handleDateChange();
  } catch (err) {
    if (token !== requestToken) { hideLoading(); return; }
    showError(err.message || 'Something went wrong. Try again.');
    return;
  }

  hideLoading();
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
