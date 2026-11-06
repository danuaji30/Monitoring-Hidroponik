// ==============================================================
// 1. KONFIGURASI WEB APP GOOGLE APPS SCRIPT & KREDENSIAL
// ==============================================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbycOnRCQqVl65n79biPf16Q5UyLYrsL3NA8q0HJ1id08539OoLeZnmuwW8EGrXqgjQz/exec";
const ADMIN_PASSWORD_BENAR = "sibibikinpusing";

// Penampung data ekspor CSV & penanggalan dinamis (WIB / Asia/Jakarta)
let activeExportData = [];
const todayString = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // Format: YYYY-MM-DD
const currentMonthString = todayString.substring(0, 7); // Format: YYYY-MM
let currentExportDate = todayString;

// Penyimpanan nilai sensor terakhir untuk evaluasi instan saat batas diubah
let lastSuhu = null;
let lastPh = null;
let lastEc = null;
let lastStatusDiag = "NORMAL";

// Helper validasi status aktif pompa (kebal tipe boolean true/false, string "ON"/"true"/"1", maupun integer 1)
function isPumpActive(val) {
  return val === true || val === "true" || val === "ON" || val === 1 || val === "1";
}

// ==============================================================
// 2. JAM REAL-TIME & PENGATUR TEMA (DARK / LIGHT)
// ==============================================================
const htmlEl = document.documentElement;
const btnTheme = document.getElementById('btn-theme');

if (btnTheme) {
  btnTheme.addEventListener('click', () => {
    const isDark = htmlEl.getAttribute('data-theme') === 'dark';
    htmlEl.setAttribute('data-theme', isDark ? 'light' : 'dark');
    btnTheme.innerText = isDark ? '🌙' : '☀️';
  });
}

function updateClock() {
  const elDate = document.getElementById('rt-date');
  const elTime = document.getElementById('rt-time');
  if (!elDate || !elTime) return;

  const now = new Date();
  const opsiTgl = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' };
  const opsiJam = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
  elDate.innerText = now.toLocaleDateString('id-ID', opsiTgl).toUpperCase();
  elTime.innerText = now.toLocaleTimeString('id-ID', opsiJam);
}
setInterval(updateClock, 1000);
updateClock();

// ==============================================================
// 3. SISTEM AUTH ADMIN & KONTROL MANUAL
// ==============================================================
let isAdmin = false;
const btnAuth = document.getElementById('btn-auth');
const modalLogin = document.getElementById('modal-login');
const btnLoginCancel = document.getElementById('btn-login-cancel');
const btnLoginSubmit = document.getElementById('btn-login-submit');
const loginError = document.getElementById('login-error');
const adminElements = document.querySelectorAll('.admin-only');

const toggleMode = document.getElementById('toggle-mode');
const toggleA = document.getElementById('toggle-a');
const toggleB = document.getElementById('toggle-b');
const togglePh = document.getElementById('toggle-ph');
const toggleCirc = document.getElementById('toggle-circ');

function updateDosingInputsState() {
  const isAuto = toggleMode ? toggleMode.checked : true;
  const canControlDosing = isAdmin && !isAuto;
  if (toggleA) toggleA.disabled = !canControlDosing;
  if (toggleB) toggleB.disabled = !canControlDosing;
  if (togglePh) togglePh.disabled = !canControlDosing;
  if (toggleCirc) toggleCirc.disabled = !isAdmin;
}

function setAdminMode(status) {
  isAdmin = status;
  adminElements.forEach(el => {
    if (status) el.classList.remove('locked');
    else el.classList.add('locked');
  });

  if (toggleMode) toggleMode.disabled = !status;
  updateDosingInputsState();

  if (btnAuth) {
    if (status) {
      btnAuth.innerHTML = '✅ Logout Admin';
      btnAuth.classList.add('logged-in');
      sessionStorage.setItem('hydroAdminLoggedIn', 'true');
    } else {
      btnAuth.innerHTML = '🔑 Login Admin';
      btnAuth.classList.remove('logged-in');
      sessionStorage.removeItem('hydroAdminLoggedIn');
    }
  }
}

// Cek sesi login saat halaman dimuat
if (sessionStorage.getItem('hydroAdminLoggedIn') === 'true') {
  setAdminMode(true);
}

if (btnAuth) {
  btnAuth.addEventListener('click', () => {
    if (isAdmin) {
      if (confirm("Logout dari mode Admin?")) setAdminMode(false);
    } else if (modalLogin) {
      modalLogin.classList.add('show');
      if (loginError) loginError.style.display = 'none';
      const passIn = document.getElementById('login-pass');
      if (passIn) {
        passIn.value = '';
        passIn.focus();
      }
    }
  });
}

// Buka modal login otomatis jika elemen kontrol terkunci diklik
document.querySelectorAll('.admin-only').forEach(ctrl => {
  ctrl.addEventListener('click', (e) => {
    if (!isAdmin && modalLogin) {
      e.stopPropagation();
      modalLogin.classList.add('show');
      if (loginError) loginError.style.display = 'none';
      const passIn = document.getElementById('login-pass');
      if (passIn) {
        passIn.value = '';
        passIn.focus();
      }
    }
  });
});

if (btnLoginCancel && modalLogin) {
  btnLoginCancel.addEventListener('click', () => modalLogin.classList.remove('show'));
}

if (modalLogin) {
  modalLogin.addEventListener('click', (e) => {
    if (e.target === modalLogin) modalLogin.classList.remove('show');
  });
}

if (btnLoginSubmit) {
  btnLoginSubmit.addEventListener('click', () => {
    const passInput = document.getElementById('login-pass');
    if (passInput && passInput.value === ADMIN_PASSWORD_BENAR) {
      setAdminMode(true);
      if (modalLogin) modalLogin.classList.remove('show');
    } else if (loginError) {
      loginError.style.display = 'block';
    }
  });
}

const inputPass = document.getElementById('login-pass');
if (inputPass && btnLoginSubmit) {
  inputPass.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnLoginSubmit.click();
  });
}

function kirimKontrolKeServer(payload) {
  if (!GAS_URL || !GAS_URL.startsWith("https://")) return;
  fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Gagal mengirim kontrol ke server:", err));
}

// Event listener switch kontrol manual
if (toggleMode) {
  toggleMode.addEventListener('change', (e) => {
    if (!isAdmin) return;
    const isAuto = e.target.checked;
    const txtMode = document.getElementById('txt-mode');
    if (txtMode) txtMode.innerText = isAuto ? "Otomasi Dosing" : "Mode Manual";
    updateDosingInputsState();
    kirimKontrolKeServer({ action: "set_mode", otomatis: isAuto, auth_key: ADMIN_PASSWORD_BENAR });
  });
}

if (toggleA) {
  toggleA.addEventListener('change', (e) => {
    if (!isAdmin || (toggleMode && toggleMode.checked)) return;
    updatePumpUI('a', e.target.checked);
    kirimKontrolKeServer({ action: "set_pump", target: "pompa_a", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
  });
}

if (toggleB) {
  toggleB.addEventListener('change', (e) => {
    if (!isAdmin || (toggleMode && toggleMode.checked)) return;
    updatePumpUI('b', e.target.checked);
    kirimKontrolKeServer({ action: "set_pump", target: "pompa_b", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
  });
}

if (togglePh) {
  togglePh.addEventListener('change', (e) => {
    if (!isAdmin || (toggleMode && toggleMode.checked)) return;
    updatePumpUI('ph', e.target.checked);
    kirimKontrolKeServer({ action: "set_pump", target: "pompa_ph", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
  });
}

if (toggleCirc) {
  toggleCirc.addEventListener('change', (e) => {
    if (!isAdmin) return;
    updateCirculationUI(e.target.checked);
    kirimKontrolKeServer({ action: "set_pump", target: "pompa_sirkulasi", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
  });
}

// ==============================================================
// 4. BATAS TARGET MIN-MAX NUTRISI
// ==============================================================
let minEc = parseFloat(localStorage.getItem('minEc')) || 1000;
let maxEc = parseFloat(localStorage.getItem('maxEc')) || 1200;
let minPh = parseFloat(localStorage.getItem('minPh')) || 5.8;
let maxPh = parseFloat(localStorage.getItem('maxPh')) || 6.2;
let minSuhu = parseFloat(localStorage.getItem('minSuhu')) || 22.0;
let maxSuhu = parseFloat(localStorage.getItem('maxSuhu')) || 28.0;

function renderRangeLabels() {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };

  setVal('in-min-ec', minEc);
  setVal('in-max-ec', maxEc);
  setVal('in-min-ph', minPh);
  setVal('in-max-ph', maxPh);
  setVal('in-min-suhu', minSuhu);
  setVal('in-max-suhu', maxSuhu);

  setText('lbl-range-ec', `${minEc} - ${maxEc}`);
  setText('lbl-range-ph', `${minPh.toFixed(1)} - ${maxPh.toFixed(1)}`);
  setText('lbl-range-suhu', `${minSuhu.toFixed(1)} - ${maxSuhu.toFixed(1)}`);

  // Evaluasi ulang kartu jika sudah ada data tersimpan
  if (lastSuhu !== null && lastPh !== null && lastEc !== null) {
    updateSensorCards(lastSuhu, lastPh, lastEc, lastStatusDiag);
  }
}
renderRangeLabels();

const setupSaveBtn = (btnId, minId, maxId, sMin, sMax, setMin, setMax, act) => {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!isAdmin) return;
    const minV = parseFloat(document.getElementById(minId)?.value);
    const maxV = parseFloat(document.getElementById(maxId)?.value);
    if (!isNaN(minV) && !isNaN(maxV) && minV < maxV) {
      setMin(minV); setMax(maxV);
      localStorage.setItem(sMin, minV);
      localStorage.setItem(sMax, maxV);
      renderRangeLabels();
      kirimKontrolKeServer({ action: "set_target", ...act(minV, maxV), auth_key: ADMIN_PASSWORD_BENAR });
      alert("✅ Pengaturan target disimpan!");
    } else {
      alert("⚠️ Nilai Min harus lebih kecil dari Max!");
    }
  });
};

setupSaveBtn('btn-save-ec', 'in-min-ec', 'in-max-ec', 'minEc', 'maxEc', v => minEc = v, v => maxEc = v, (min, max) => ({ min_ec: min, max_ec: max }));
setupSaveBtn('btn-save-ph', 'in-min-ph', 'in-max-ph', 'minPh', 'maxPh', v => minPh = v, v => maxPh = v, (min, max) => ({ min_ph: min, max_ph: max }));
setupSaveBtn('btn-save-suhu', 'in-min-suhu', 'in-max-suhu', 'minSuhu', 'maxSuhu', v => minSuhu = v, v => maxSuhu = v, (min, max) => ({ min_suhu: min, max_suhu: max }));

// ==============================================================
// 5. INISIALISASI CHART.JS DENGAN FITUR GESER (PAN/ZOOM)
// ==============================================================
let currentChartMode = 'today'; // 'today', 'custom_date', atau 'history'
let todayDataSeries = [];
let allHourlyData = [];
let historyHourlySeries = [];

const chartCanvas = document.getElementById('sensorChart');
let sensorChart = null;

if (chartCanvas) {
  const ctx = chartCanvas.getContext('2d');
  sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'pH Air', borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, data: [], tension: 0.3, pointRadius: 2, yAxisID: 'y' },
        { label: 'Nutrisi (ppm)', borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, data: [], tension: 0.3, pointRadius: 2, yAxisID: 'y1' },
        { label: 'Suhu (°C)', borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', data: [], tension: 0.3, pointRadius: 2, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#8b9bb4', boxWidth: 12, font: { size: 11 } } },
        zoom: {
          pan: { enabled: true, mode: 'x', modifierKey: null },
          zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }
        }
      },
      scales: {
        x: { ticks: { color: '#8b9bb4', font: { size: 10 }, maxRotation: 0 }, grid: { color: 'rgba(148,163,184,0.1)' } },
        y: { type: 'linear', position: 'left', ticks: { color: '#8b9bb4', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.1)' } },
        y1: { type: 'linear', position: 'right', ticks: { color: '#10b981', font: { size: 10 } }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

const btnResetZoom = document.getElementById('btn-reset-zoom');
if (btnResetZoom && sensorChart) {
  btnResetZoom.addEventListener('click', () => sensorChart.resetZoom());
}

// ==============================================================
// 6. PEMUATAN DATA GRAFIK (HARI INI, PILIH HARI, & RATA-RATA BULANAN)
// ==============================================================
async function loadTodayData() {
  if (!GAS_URL) return;
  const counter = document.getElementById('log-counter');
  if (counter) counter.innerText = "Memuat data hari ini...";

  try {
    const res = await fetch(`${GAS_URL}?action=read_today`, { method: "GET", redirect: "follow" });
    const json = await res.json();
    if (json.status === "success" && Array.isArray(json.data)) {
      todayDataSeries = [];
      activeExportData = [];
      currentExportDate = todayString;

      json.data.forEach(item => {
        const d = new Date(item.waktu);
        const tglWaktu = `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
        const jam = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        const rowObj = { fullTime: tglWaktu, time: jam, ph: Number(item.ph), ec: Math.round(Number(item.ppm)), suhu: Number(item.suhu), status: item.err_sensor };
        todayDataSeries.push(rowObj);
        activeExportData.push(rowObj);
      });

      if (currentChartMode === 'today') renderTodayChart();
    }
  } catch (err) {
    console.warn("Gagal memuat data hari ini:", err);
  }
}

function renderTodayChart() {
  if (!sensorChart) return;
  sensorChart.data.labels = todayDataSeries.map(i => i.time);
  sensorChart.data.datasets[0].data = todayDataSeries.map(i => i.ph);
  sensorChart.data.datasets[1].data = todayDataSeries.map(i => i.ec);
  sensorChart.data.datasets[2].data = todayDataSeries.map(i => i.suhu);
  sensorChart.update();
  sensorChart.resetZoom();
  const counter = document.getElementById('log-counter');
  if (counter) counter.innerText = `Data Hari Ini (${todayString}): ${todayDataSeries.length} sampel`;
}

// Pemuatan data berdasarkan tanggal yang dipilih (Fitur Pilih Hari)
async function loadDataByDate(dateStr) {
  if (!GAS_URL) return;
  const logCounter = document.getElementById('log-counter');
  if (logCounter) logCounter.innerText = `Memuat data tanggal ${dateStr}...`;

  try {
    const res = await fetch(`${GAS_URL}?action=read_by_date&date=${dateStr}`, { method: "GET", redirect: "follow" });
    const json = await res.json();

    if (json.status === "success" && Array.isArray(json.data)) {
      currentExportDate = dateStr;
      activeExportData = [];

      if (json.data.length === 0) {
        alert(`ℹ️ Tidak ada catatan data sensor pada tanggal ${dateStr}.`);
        if (logCounter) logCounter.innerText = `Data ${dateStr}: 0 sampel`;
        if (sensorChart) {
          sensorChart.data.labels = [];
          sensorChart.data.datasets.forEach(ds => ds.data = []);
          sensorChart.update();
        }
        return;
      }

      const labels = [], phPoints = [], ecPoints = [], suhuPoints = [];
      json.data.forEach(item => {
        const d = new Date(item.waktu);
        const tglWaktu = `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
        const jam = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        labels.push(jam);
        phPoints.push(Number(item.ph));
        ecPoints.push(Math.round(Number(item.ppm)));
        suhuPoints.push(Number(item.suhu));

        activeExportData.push({ fullTime: tglWaktu, time: jam, ph: Number(item.ph), ec: Math.round(Number(item.ppm)), suhu: Number(item.suhu), status: item.err_sensor });
      });

      if (sensorChart) {
        sensorChart.data.labels = labels;
        sensorChart.data.datasets[0].data = phPoints;
        sensorChart.data.datasets[1].data = ecPoints;
        sensorChart.data.datasets[2].data = suhuPoints;
        sensorChart.update();
        sensorChart.resetZoom();
      }

      if (logCounter) {
        logCounter.innerText = `Riwayat ${dateStr}: ${json.data.length} sampel (Siap Unduh CSV)`;
      }
    }
  } catch (err) {
    console.error(`Gagal mengambil data tanggal ${dateStr}:`, err);
  }
}

// Pemuatan data rata-rata per jam cukup pilih bulan (Fitur Pilih Bulan)
async function loadHourlyHistoryForMonth(monthStr) {
  if (!GAS_URL) return;
  const counter = document.getElementById('log-counter');
  if (counter) counter.innerText = `Memuat riwayat jam bulan ${monthStr}...`;

  try {
    if (allHourlyData.length === 0) {
      const res = await fetch(`${GAS_URL}?action=read_hourly_history`, { method: "GET", redirect: "follow" });
      const json = await res.json();
      if (json.status === "success" && Array.isArray(json.data)) {
        allHourlyData = json.data;
      }
    }

    // Filter berdasarkan bulan yang dipilih (item.bucket berformat "YYYY-MM-DD HH:MM")
    const filtered = allHourlyData.filter(item => {
      if (!item.bucket) return false;
      return item.bucket.startsWith(monthStr);
    });

    historyHourlySeries = filtered;
    currentExportDate = monthStr;
    renderHistoryChart(monthStr);
  } catch (err) {
    console.warn("Gagal memuat riwayat per jam:", err);
    if (counter) counter.innerText = "Gagal memuat riwayat per jam.";
  }
}

function renderHistoryChart(monthStr = "") {
  if (!sensorChart) return;
  sensorChart.data.labels = historyHourlySeries.map(i => i.label);
  sensorChart.data.datasets[0].data = historyHourlySeries.map(i => Number(i.avg_ph));
  sensorChart.data.datasets[1].data = historyHourlySeries.map(i => Math.round(Number(i.avg_ppm)));
  sensorChart.data.datasets[2].data = historyHourlySeries.map(i => Number(i.avg_suhu));
  sensorChart.update();
  sensorChart.resetZoom();

  const counter = document.getElementById('log-counter');
  if (counter) {
    if (historyHourlySeries.length === 0) {
      counter.innerText = `Riwayat Bulan ${monthStr}: 0 data jam`;
    } else {
      counter.innerText = `Riwayat Agregasi ${monthStr}: ${historyHourlySeries.length} jam (Geser/Zoom grafik)`;
    }
  }
}

// Elemen Navigasi & Filter Mode Grafik
const btnModeToday = document.getElementById('btn-mode-today');
const btnModeHistory = document.getElementById('btn-mode-history');
const wrapperDateFilter = document.getElementById('wrapper-date-filter');
const wrapperMonthFilter = document.getElementById('wrapper-month-filter');
const inputDateFilter = document.getElementById('input-date-filter');
const inputMonthFilter = document.getElementById('input-month-filter');
const btnQuickToday = document.getElementById('btn-quick-today');

// Elemen Baru: Dropdown Bulan, Tahun, & Tombol Cepat Bulan Ini
const selectMonth = document.getElementById('select-month');
const selectYear = document.getElementById('select-year');
const btnQuickMonth = document.getElementById('btn-quick-month');

// Fungsi pembantu untuk sinkronisasi nilai bulan (format YYYY-MM)
function getSelectedMonthPeriod() {
  if (!selectYear || !selectMonth) return currentMonthString;
  const y = selectYear.value;
  const m = selectMonth.value;
  const monthPeriod = `${y}-${m}`;
  if (inputMonthFilter) inputMonthFilter.value = monthPeriod;
  return monthPeriod;
}

function setMonthPeriodUI(yearMonthStr) {
  if (!yearMonthStr) return;
  const [year, month] = yearMonthStr.split('-');
  if (selectYear) selectYear.value = year;
  if (selectMonth) selectMonth.value = month;
  if (inputMonthFilter) inputMonthFilter.value = yearMonthStr;
}

// Inisialisasi nilai awal input filter
if (inputDateFilter) {
  inputDateFilter.max = todayString;
  inputDateFilter.value = todayString;
}
setMonthPeriodUI(currentMonthString);

// Handler tombol mode: "Hari Ini / Pilih Hari"
if (btnModeToday) {
  btnModeToday.addEventListener('click', () => {
    btnModeToday.classList.add('active');
    if (btnModeHistory) btnModeHistory.classList.remove('active');

    if (wrapperDateFilter) wrapperDateFilter.style.display = 'flex';
    if (wrapperMonthFilter) wrapperMonthFilter.style.display = 'none';

    const selectedDate = inputDateFilter ? inputDateFilter.value : todayString;
    if (selectedDate === todayString) {
      currentChartMode = 'today';
      renderTodayChart();
    } else {
      currentChartMode = 'custom_date';
      loadDataByDate(selectedDate);
    }
  });
}

// Handler tombol mode: "Rata-rata/Jam (Pilih Bulan)"
if (btnModeHistory) {
  btnModeHistory.addEventListener('click', () => {
    currentChartMode = 'history';
    btnModeHistory.classList.add('active');
    if (btnModeToday) btnModeToday.classList.remove('active');

    if (wrapperDateFilter) wrapperDateFilter.style.display = 'none';
    if (wrapperMonthFilter) wrapperMonthFilter.style.display = 'flex';

    const selectedMonth = getSelectedMonthPeriod();
    loadHourlyHistoryForMonth(selectedMonth);
  });
}

// Handler perubahan tanggal pada filter hari
if (inputDateFilter) {
  inputDateFilter.addEventListener('change', async (e) => {
    const selectedDate = e.target.value;
    if (!selectedDate) return;

    if (selectedDate === todayString) {
      currentChartMode = 'today';
      loadTodayData();
    } else {
      currentChartMode = 'custom_date';
      await loadDataByDate(selectedDate);
    }
  });
}

// Handler tombol shortcut "Hari Ini"
if (btnQuickToday) {
  btnQuickToday.addEventListener('click', () => {
    if (inputDateFilter) inputDateFilter.value = todayString;
    currentChartMode = 'today';
    btnModeToday.classList.add('active');
    if (btnModeHistory) btnModeHistory.classList.remove('active');
    if (wrapperDateFilter) wrapperDateFilter.style.display = 'flex';
    if (wrapperMonthFilter) wrapperMonthFilter.style.display = 'none';
    loadTodayData();
  });
}

// Handler saat dropdown Bulan atau Tahun diubah
function onMonthYearChange() {
  const selectedPeriod = getSelectedMonthPeriod();
  loadHourlyHistoryForMonth(selectedPeriod);
}

if (selectMonth) selectMonth.addEventListener('change', onMonthYearChange);
if (selectYear) selectYear.addEventListener('change', onMonthYearChange);

// Handler tombol shortcut "Bulan Ini"
if (btnQuickMonth) {
  btnQuickMonth.addEventListener('click', () => {
    setMonthPeriodUI(currentMonthString);
    loadHourlyHistoryForMonth(currentMonthString);
  });
}

// Inisialisasi awal saat web dibuka
loadTodayData();

// ==============================================================
// 7. POLLING DATA REAL-TIME TIAP 6 DETIK
// ==============================================================
let lastRecordedTimestamp = null;

async function fetchLatestFromSheets() {
  if (!GAS_URL || !GAS_URL.startsWith("https://")) return;

  try {
    const response = await fetch(`${GAS_URL}?action=read_latest`, { method: "GET", redirect: "follow" });
    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const json = await response.json();

    if (json.status === "success" && json.data) {
      // Simpan pembacaan terakhir
      lastSuhu = json.data.suhu;
      lastPh = json.data.ph;
      lastEc = json.data.ppm;
      lastStatusDiag = json.data.err_sensor || "NORMAL";

      updateSensorCards(json.data.suhu, json.data.ph, json.data.ppm, json.data.err_sensor);

      // Sinkronkan status sakelar pompa dengan helper isPumpActive
      updatePumpUI('a', isPumpActive(json.data.pompa_a));
      updatePumpUI('b', isPumpActive(json.data.pompa_b));
      updatePumpUI('ph', isPumpActive(json.data.pompa_ph));
      updateCirculationUI(isPumpActive(json.data.pompa_sirkulasi));

      // Jika timestamp baru masuk, perbarui deret data hari ini
      if (json.data.waktu !== lastRecordedTimestamp) {
        lastRecordedTimestamp = json.data.waktu;

        const d = new Date(json.data.waktu);
        const tglWaktu = `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
        const jam = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        const rowObj = {
          fullTime: tglWaktu,
          time: jam,
          ph: Number(json.data.ph),
          ec: Math.round(Number(json.data.ppm)),
          suhu: Number(json.data.suhu),
          status: json.data.err_sensor
        };

        todayDataSeries.push(rowObj);

        // Hanya perbarui grafik jika sedang melihat mode Hari Ini
        if (currentChartMode === 'today') {
          activeExportData.push(rowObj);
          renderTodayChart();
        }
      }

      // Sinkronkan mode otomasi/manual
      if (json.data.otomatis !== undefined && toggleMode) {
        const isAuto = Boolean(json.data.otomatis);
        toggleMode.checked = isAuto;
        const txtMode = document.getElementById('txt-mode');
        if (txtMode) txtMode.innerText = isAuto ? "Otomasi Dosing" : "Mode Manual";
        updateDosingInputsState();
      }

      // Indikator status online/offline ESP32
      const waktuServer = new Date(json.data.waktu).getTime();
      const selisihDetik = Math.abs(Math.floor((Date.now() - waktuServer) / 1000));
      if (!isNaN(waktuServer) && selisihDetik > 120) {
        tandaiEspOffline(selisihDetik);
      } else {
        kembalikanStatusOnline();
      }
    }
  } catch (err) {
    console.error("Gagal sinkronisasi data dari Sheets:", err);
  }
}

fetchLatestFromSheets();
setInterval(fetchLatestFromSheets, 6000);

// ==============================================================
// 8. PEMBARUAN TAMPILAN KARTU & STATUS SAKELAR POMPA
// ==============================================================
function updateSensorCards(suhu, ph, ec, statusDiag = "NORMAL") {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  const numPh = Number(ph);
  const numEc = Number(ec);
  const numSuhu = Number(suhu);

  setVal('val-ph', !isNaN(numPh) ? numPh.toFixed(2) : '--');
  setVal('val-ec', !isNaN(numEc) ? Math.round(numEc) : '--');
  setVal('val-suhu', !isNaN(numSuhu) ? numSuhu.toFixed(1) : '--');

  const boxPh = document.getElementById('box-ph');
  const boxEc = document.getElementById('box-ec');
  const boxSuhu = document.getElementById('box-suhu');

  // Evaluasi status individual setiap sensor terhadap target min-max
  const isPhLow = !isNaN(numPh) && numPh < minPh;
  const isPhHigh = !isNaN(numPh) && numPh > maxPh;
  const isEcLow = !isNaN(numEc) && numEc < minEc;
  const isEcHigh = !isNaN(numEc) && numEc > maxEc;
  const isSuhuLow = !isNaN(numSuhu) && numSuhu < minSuhu;
  const isSuhuHigh = !isNaN(numSuhu) && numSuhu > maxSuhu;

  if (boxPh) {
    boxPh.classList.remove('status-warn', 'status-danger');
    if (isPhLow || isPhHigh) boxPh.classList.add(isPhHigh ? 'status-danger' : 'status-warn');
  }
  if (boxEc) {
    boxEc.classList.remove('status-warn', 'status-danger');
    if (isEcLow || isEcHigh) boxEc.classList.add(isEcHigh ? 'status-danger' : 'status-warn');
  }
  if (boxSuhu) {
    boxSuhu.classList.remove('status-warn', 'status-danger');
    if (isSuhuLow || isSuhuHigh) boxSuhu.classList.add(isSuhuHigh ? 'status-danger' : 'status-warn');
  }

  // Sinkronisasi status banner utama
  const badge = document.getElementById('overall-badge');
  if (badge) {
    // Diagnosa normal jika mengandung kata "NORMAL" (misal: "NORMAL" atau "SIMULASI_NORMAL")
    const isNormalDiag = !statusDiag || statusDiag.toUpperCase().includes("NORMAL");

    if (!isNormalDiag) {
      badge.innerText = `⚠️ ANOMALI: ${statusDiag}`;
      badge.className = "badge-pill danger";
    } else if (isEcLow || isPhLow) {
      badge.innerText = "● KURANG (DOSING DIPERLUKAN)";
      badge.className = "badge-pill warn";
    } else if (isEcHigh || isPhHigh || isSuhuHigh) {
      badge.innerText = "● MELEBIHI BATAS MAKSIMAL";
      badge.className = "badge-pill danger";
    } else if (isSuhuLow) {
      badge.innerText = "● SUHU AIR DI BAWAH TARGET";
      badge.className = "badge-pill warn";
    } else {
      badge.innerText = "● RENTANG IDEAL PAKCOY";
      badge.className = "badge-pill";
    }
  }
}

// Pembaruan UI Pompa Nutrisi & Penstabil pH (Dinamis, Menarik & Hidup)
function updatePumpUI(prefix, isOn) {
  const toggleEl = document.getElementById(`toggle-${prefix}`);
  const dotEl    = document.getElementById(`dot-${prefix}`);
  const txtEl    = document.getElementById(`status-txt-${prefix}`);
  const cardEl   = document.getElementById(`card-${prefix}`);

  if (toggleEl) toggleEl.checked = isOn;
  if (dotEl) {
    if (isOn) {
      dotEl.className = prefix === 'ph' ? "dot on-blue" : "dot on";
    } else {
      dotEl.className = "dot";
    }
  }
  if (txtEl) {
    txtEl.innerText = isOn ? "Menyala" : "Mati";
  }
  if (cardEl) {
    cardEl.classList.toggle('active-pump', isOn && prefix !== 'ph');
    cardEl.classList.toggle('active-ph', isOn && prefix === 'ph');
  }
}

// Pembaruan UI Pompa Sirkulasi (Dinamis dengan Efek Gelombang Aliran Air)
function updateCirculationUI(isOn) {
  const toggleEl = document.getElementById('toggle-circ');
  const dotEl    = document.getElementById('dot-circ');
  const txtEl    = document.getElementById('status-txt-circ');
  const cardEl   = document.getElementById('card-circ');

  if (toggleEl) toggleEl.checked = isOn;
  if (dotEl) {
    dotEl.className = isOn ? "dot on-cyan" : "dot";
  }
  if (txtEl) {
    txtEl.innerText = isOn ? "Mengalir (Aktif)" : "Mati";
  }
  if (cardEl) {
    cardEl.classList.toggle('active-circulation', isOn);
  }
}

function tandaiEspOffline(selisihDetik) {
  const badge = document.getElementById('overall-badge');
  if (badge) {
    badge.className = "badge-pill danger";
    const menit = Math.floor(selisihDetik / 60);
    const jam = Math.floor(menit / 60);
    let strWaktu = `${selisihDetik} dtk`;
    if (jam > 0) strWaktu = `${jam} jam ${menit % 60} mnt`;
    else if (menit > 0) strWaktu = `${menit} mnt`;
    badge.innerText = `🔴 ESP32 OFFLINE (${strWaktu} lalu)`;
  }
  ['val-ph', 'val-ec', 'val-suhu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = "0.7";
  });
  // Catatan: Jangan mematikan sakelar status pompa di UI saat offline
  // agar tetap mencerminkan status telemetri terakhir yang tercatat di database
}

function kembalikanStatusOnline() {
  ['val-ph', 'val-ec', 'val-suhu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = "1.0";
  });
}

// ==============================================================
// 9. UNDUH CSV DINAMIS & RESET CACHE LOKAL
// ==============================================================
const btnDownload = document.getElementById('btn-download');
if (btnDownload) {
  btnDownload.addEventListener('click', () => {
    // 1. Jika dalam mode Rata-rata/Jam (Bulanan)
    if (currentChartMode === 'history') {
      if (!historyHourlySeries || historyHourlySeries.length === 0) {
        alert(`⚠️ Tidak ada data rata-rata per jam untuk bulan ${currentExportDate}.`);
        return;
      }

      let csvContent = "\uFEFFJam / Periode,Rata-rata pH,Rata-rata Nutrisi TDS (PPM),Rata-rata Suhu Air (°C),Jumlah Sampel\n";
      historyHourlySeries.forEach(r => {
        csvContent += `"${r.label}",${Number(r.avg_ph).toFixed(2)},${Math.round(Number(r.avg_ppm))},${Number(r.avg_suhu).toFixed(1)},${r.samples || 0}\n`;
      });

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Log_RataRata_PerJam_${currentExportDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return;
    }

    // 2. Jika dalam mode Data Harian
    const dateInput = document.getElementById('input-date-filter');
    const targetDate = (dateInput && dateInput.value) ? dateInput.value : currentExportDate;

    if (!activeExportData || activeExportData.length === 0) {
      alert(`⚠️ Tidak ada data sensor untuk tanggal ${targetDate}.`);
      return;
    }

    let csvContent = "\uFEFFWaktu Pencatatan,pH Air,Nutrisi TDS (PPM),Suhu Air (°C),Diagnosa Sensor\n";
    activeExportData.forEach(r => {
      csvContent += `"${r.fullTime}",${Number(r.ph).toFixed(2)},${Math.round(Number(r.ec))},${Number(r.suhu).toFixed(1)},"${r.status || 'NORMAL'}"\n`;
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Log_Hidroponik_Pakcoy_${targetDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}

const btnResetCache = document.getElementById('btn-reset-cache');
if (btnResetCache) {
  btnResetCache.addEventListener('click', () => {
    if (!confirm("Hapus seluruh cache riwayat lokal di browser ini? Data asli di Google Sheets tetap aman.")) return;
    localStorage.removeItem('hydroHistoryData');
    allHourlyData = [];
    todayDataSeries = [];
    historyHourlySeries = [];
    activeExportData = [];
    if (sensorChart) {
      sensorChart.data.labels = [];
      sensorChart.data.datasets.forEach(ds => ds.data = []);
      sensorChart.update();
    }
    loadTodayData();
    alert("✅ Cache riwayat lokal berhasil dibersihkan!");
  });
}
