const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

async function geocode(postcode) {
  const pc = normalizePostcode(postcode);
  if (!pc) throw new Error('Enter a valid UK postcode (e.g. SW1A 1AA).');
  const url = `https://api.postcodes.io/postcodes/${pc}`;
  const res = await fetch(url);
  if (res.status === 404) throw new Error(`Postcode "${pc}" not found. Check it and try again.`);
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
