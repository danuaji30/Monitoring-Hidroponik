// ==============================================================
// 1. KONFIGURASI WEB APP GOOGLE APPS SCRIPT
// ==============================================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbycOnRCQqVl65n79biPf16Q5UyLYrsL3NA8q0HJ1id08539OoLeZnmuwW8EGrXqgjQz/exec";
const ADMIN_PASSWORD_BENAR = "sibibikinpusing";

// Variabel data ekspor aktif & penanggalan
let activeExportData = [];
let currentExportDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }); // YYYY-MM-DD

// ==============================================================
// 2. JAM REAL-TIME & TEMA
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
// 3. AUTH ADMIN & KONTROL MANUAL
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

if (btnLoginCancel && modalLogin) btnLoginCancel.addEventListener('click', () => modalLogin.classList.remove('show'));
if (modalLogin) modalLogin.addEventListener('click', (e) => { if (e.target === modalLogin) modalLogin.classList.remove('show'); });

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

function kirimKontrolKeServer(payload) {
  if (!GAS_URL || !GAS_URL.startsWith("https://")) return;
  fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Gagal sinkron perintah pompa:", err));
}

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
// 4. BATAS TARGET MIN-MAX
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
let currentChartMode = 'today';
let todayDataSeries = [];
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
        { label: 'Suhu (°C)', borderColor: '#f59e0b', data: [], tension: 0.3, pointRadius: 2, yAxisID: 'y' }
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
// 6. LOGIKA PEMUATAN DATA GRAFIK (HARI INI, RIWAYAT, DATE PICKER)
// ==============================================================
async function loadTodayData() {
  if (!GAS_URL) return;
  try {
    const res = await fetch(`${GAS_URL}?action=read_today`, { method: "GET", redirect: "follow" });
    const json = await res.json();
    if (json.status === "success" && Array.isArray(json.data)) {
      todayDataSeries = [];
      activeExportData = [];
      currentExportDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

      json.data.forEach(item => {
        const d = new Date(item.waktu);
        const tglWaktu = `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
        const jam = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        const rowObj = { fullTime: tglWaktu, time: jam, ph: item.ph, ec: item.ppm, suhu: item.suhu, status: item.err_sensor };
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
  document.getElementById('log-counter').innerText = `Data Hari Ini: ${todayDataSeries.length} sampel`;
}

async function loadHistoryData() {
  if (!GAS_URL) return;
  try {
    document.getElementById('log-counter').innerText = "Memuat riwayat jam...";
    const res = await fetch(`${GAS_URL}?action=read_hourly_history`, { method: "GET", redirect: "follow" });
    const json = await res.json();
    if (json.status === "success" && Array.isArray(json.data)) {
      historyHourlySeries = json.data;
      if (currentChartMode === 'history') renderHistoryChart();
    }
  } catch (err) {
    console.warn("Gagal memuat riwayat per jam:", err);
  }
}

function renderHistoryChart() {
  if (!sensorChart) return;
  sensorChart.data.labels = historyHourlySeries.map(i => i.label);
  sensorChart.data.datasets[0].data = historyHourlySeries.map(i => i.avg_ph);
  sensorChart.data.datasets[1].data = historyHourlySeries.map(i => i.avg_ppm);
  sensorChart.data.datasets[2].data = historyHourlySeries.map(i => i.avg_suhu);
  sensorChart.update();
  sensorChart.resetZoom();
  document.getElementById('log-counter').innerText = `Riwayat Agregasi: ${historyHourlySeries.length} jam (Geser untuk telusuri)`;
}

const btnModeToday = document.getElementById('btn-mode-today');
const btnModeHistory = document.getElementById('btn-mode-history');

if (btnModeToday && btnModeHistory) {
  btnModeToday.addEventListener('click', () => {
    currentChartMode = 'today';
    btnModeToday.classList.add('active');
    btnModeHistory.classList.remove('active');
    renderTodayChart();
  });

  btnModeHistory.addEventListener('click', () => {
    currentChartMode = 'history';
    btnModeHistory.classList.add('active');
    btnModeToday.classList.remove('active');
    if (historyHourlySeries.length === 0) {
      loadHistoryData();
    } else {
      renderHistoryChart();
    }
  });
}

// LOGIKA DATE PICKER
const inputDateFilter = document.getElementById('input-date-filter');
const todayString = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

if (inputDateFilter) {
  inputDateFilter.max = todayString;
  inputDateFilter.value = todayString;

  inputDateFilter.addEventListener('change', async (e) => {
    const selectedDate = e.target.value;
    if (!selectedDate) return;

    if (selectedDate === todayString) {
      currentChartMode = 'today';
      btnModeToday.classList.add('active');
      btnModeHistory.classList.remove('active');
      loadTodayData();
      return;
    }

    currentChartMode = 'custom_date';
    btnModeToday.classList.remove('active');
    btnModeHistory.classList.remove('active');
    await loadDataByDate(selectedDate);
  });
}

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
        phPoints.push(item.ph);
        ecPoints.push(item.ppm);
        suhuPoints.push(item.suhu);

        activeExportData.push({ fullTime: tglWaktu, time: jam, ph: item.ph, ec: item.ppm, suhu: item.suhu, status: item.err_sensor });
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
      if (json.data.waktu !== lastRecordedTimestamp) {
        lastRecordedTimestamp = json.data.waktu;
        updateSensorCards(json.data.suhu, json.data.ph, json.data.ppm, json.data.err_sensor);

        const d = new Date(json.data.waktu);
        const tglWaktu = `${d.toLocaleDateString('id-ID')} ${d.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
        const jam = d.toLocaleTimeString('id-ID', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });

        const rowObj = { fullTime: tglWaktu, time: jam, ph: Number(json.data.ph), ec: Math.round(Number(json.data.ppm)), suhu: Number(json.data.suhu), status: json.data.err_sensor };

        todayDataSeries.push(rowObj);

        if (currentChartMode === 'today') {
          activeExportData.push(rowObj);
          renderTodayChart();
        }
      } else {
        updateSensorCards(json.data.suhu, json.data.ph, json.data.ppm, json.data.err_sensor);
      }

      if (json.data.otomatis !== undefined && toggleMode) {
        toggleMode.checked = json.data.otomatis;
        const txtMode = document.getElementById('txt-mode');
        if (txtMode) txtMode.innerText = json.data.otomatis ? "Otomasi Dosing" : "Mode Manual";
        updateDosingInputsState();
      }

      updatePumpUI('a', json.data.pompa_a === "ON");
      updatePumpUI('b', json.data.pompa_b === "ON");
      updatePumpUI('ph', json.data.pompa_ph === "ON");
      updateCirculationUI(json.data.pompa_sirkulasi === "ON");

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
// 8. UPDATE KARTU & STATUS SAKELAR
// ==============================================================
function updateSensorCards(suhu, ph, ec, statusDiag = "NORMAL") {
  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  setVal('val-ph', Number(ph).toFixed(2));
  setVal('val-ec', Math.round(Number(ec)));
  setVal('val-suhu', Number(suhu).toFixed(1));

  const boxPh = document.getElementById('box-ph');
  const boxEc = document.getElementById('box-ec');
  const boxSuhu = document.getElementById('box-suhu');
  if (boxPh) boxPh.style.borderColor = "var(--border)";
  if (boxEc) boxEc.style.borderColor = "var(--border)";
  if (boxSuhu) boxSuhu.style.borderColor = "var(--border)";

  const badge = document.getElementById('overall-badge');
  if (badge) {
    if (statusDiag !== "NORMAL") {
      badge.innerText = `⚠️ ANOMALI: ${statusDiag}`;
      badge.className = "badge-pill danger";
      if (statusDiag.includes("PH") && boxPh) boxPh.style.borderColor = "var(--accent-red)";
      if ((statusDiag.includes("EC") || statusDiag.includes("KERING")) && boxEc) boxEc.style.borderColor = "var(--accent-amber)";
      if (statusDiag.includes("DS18B20") && boxSuhu) boxSuhu.style.borderColor = "var(--accent-red)";
    } else if (ec < minEc || ph < minPh) {
      badge.innerText = "● KURANG (DOSING DIPERLUKAN)";
      badge.className = "badge-pill warn";
    } else if (ec > maxEc || ph > maxPh || suhu > maxSuhu) {
      badge.innerText = "● MELEBIHI BATAS MAKSIMAL";
      badge.className = "badge-pill danger";
    } else if (suhu < minSuhu) {
      badge.innerText = "● SUHU AIR DI BAWAH TARGET";
      badge.className = "badge-pill warn";
    } else {
      badge.innerText = "● RENTANG IDEAL PAKCOY";
      badge.className = "badge-pill";
    }
  }
}

function updatePumpUI(prefix, isOn) {
  const toggleEl = document.getElementById(`toggle-${prefix}`);
  const dotEl    = document.getElementById(`dot-${prefix}`);
  const txtEl    = document.getElementById(`status-txt-${prefix}`);
  const cardEl   = document.getElementById(`card-${prefix}`);

  if (toggleEl) toggleEl.checked = isOn;
  if (dotEl) dotEl.className = isOn ? "dot on" : "dot";
  if (txtEl) {
    txtEl.innerText = isOn ? "Menyala" : "Mati";
    txtEl.style.color = isOn ? "var(--accent-green)" : "var(--text-muted)";
  }
  if (cardEl) cardEl.className = isOn ? "bubble-card relay-card active-glow" : "bubble-card relay-card";
}

function updateCirculationUI(isOn) {
  const toggleEl = document.getElementById('toggle-circ');
  const dotEl    = document.getElementById('dot-circ');
  const txtEl    = document.getElementById('status-txt-circ');
  const cardEl   = document.getElementById('card-circ');

  if (toggleEl) toggleEl.checked = isOn;
  if (dotEl) dotEl.className = isOn ? "dot on-cyan" : "dot";
  if (txtEl) {
    txtEl.innerText = isOn ? "Mengalir (Aktif)" : "Mati";
    txtEl.style.color = isOn ? "var(--accent-cyan)" : "var(--text-muted)";
  }
  if (cardEl) cardEl.className = isOn ? "circulation-card bubble-card active-flow" : "circulation-card bubble-card";
}

function tandaiEspOffline(selisihDetik) {
  const badge = document.getElementById('overall-badge');
  if (badge) {
    badge.className = "badge-pill danger";
    const menit = Math.floor(selisihDetik / 60);
    badge.innerText = menit > 0 ? `🔴 ESP32 OFFLINE (${menit} mnt lalu)` : `🔴 ESP32 OFFLINE (${selisihDetik} dtk lalu)`;
  }
  ['val-ph', 'val-ec', 'val-suhu'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = "0.45";
  });
  updatePumpUI('a', false);
  updatePumpUI('b', false);
  updatePumpUI('ph', false);
  updateCirculationUI(false);
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
