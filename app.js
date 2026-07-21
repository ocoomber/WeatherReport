initHourRange();
initDatePicker();
input.addEventListener('input', function () { this.value = this.value.replace(/\s/g, ''); });
form.addEventListener('submit', handleSubmit);
todayBtn.addEventListener('click', handleTodayClick);
updateBtn.addEventListener('click', handleDateChange);
locateBtn.addEventListener('click', handleUseLocation);
hourStart.addEventListener('change', handleRangeChange);
hourEnd.addEventListener('change', handleRangeChange);

const savedStart = storage.get('weather_hour_start');
const savedEnd = storage.get('weather_hour_end');
if (savedStart) hourStart.value = savedStart;
if (savedEnd) hourEnd.value = savedEnd;
const savedPostcode = storage.get('weather_postcode');
if (savedPostcode) {
  input.value = savedPostcode;
  try { form.requestSubmit(); } catch {}
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed:', err));
}
