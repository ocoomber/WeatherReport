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
