// ==============================================================
// 1. KONFIGURASI WEB APP GOOGLE APPS SCRIPT & KREDENSIAL
// ==============================================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbycOnRCQqVl65n79biPf16Q5UyLYrsL3NA8q0HJ1id08539OoLeZnmuwW8EGrXqgjQz/exec";
const ADMIN_PASSWORD_BENAR = "sibibikinpusing";

// ==============================================================
// 2. JAM REAL-TIME & TEMA TERANG / GELAP
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

// Efek Glow Mengikuti Kursor pada Kartu UI
document.querySelectorAll('.bubble-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--y', `${e.clientY - rect.top}px`);
  });
});

// ==============================================================
// 3. SISTEM AUTH ADMIN & KONTROL MANUAL INTERAKTIF
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
  if (!GAS_URL || !GAS_URL.startsWith("https://")) {
    console.warn("URL GAS belum dikonfigurasi.");
    return;
  }
  fetch(GAS_URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(err => console.error("Gagal sinkron perintah pompa:", err));
}

// Event Sakelar
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
// 4. LOGIKA TARGET RENTANG MIN-MAX (PPM, pH, SUHU)
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

const btnSaveEc = document.getElementById('btn-save-ec');
if (btnSaveEc) {
  btnSaveEc.addEventListener('click', () => {
    if (!isAdmin) return;
    const minV = parseFloat(document.getElementById('in-min-ec')?.value);
    const maxV = parseFloat(document.getElementById('in-max-ec')?.value);
    if (!isNaN(minV) && !isNaN(maxV) && minV < maxV) {
      minEc = minV; maxEc = maxV;
      localStorage.setItem('minEc', minEc);
      localStorage.setItem('maxEc', maxEc);
      renderRangeLabels();
      kirimKontrolKeServer({ action: "set_target", min_ec: minEc, max_ec: maxEc, auth_key: ADMIN_PASSWORD_BENAR });
      alert("✅ Rentang PPM berhasil disimpan!");
    } else {
      alert("⚠️ Nilai Min PPM harus lebih kecil dari Max PPM!");
    }
  });
}

const btnSavePh = document.getElementById('btn-save-ph');
if (btnSavePh) {
  btnSavePh.addEventListener('click', () => {
    if (!isAdmin) return;
    const minV = parseFloat(document.getElementById('in-min-ph')?.value);
    const maxV = parseFloat(document.getElementById('in-max-ph')?.value);
    if (!isNaN(minV) && !isNaN(maxV) && minV < maxV) {
      minPh = minV; maxPh = maxV;
      localStorage.setItem('minPh', minPh);
      localStorage.setItem('maxPh', maxPh);
      renderRangeLabels();
      kirimKontrolKeServer({ action: "set_target", min_ph: minPh, max_ph: maxPh, auth_key: ADMIN_PASSWORD_BENAR });
      alert("✅ Rentang pH berhasil disimpan!");
    } else {
      alert("⚠️ Nilai Min pH harus lebih kecil dari Max pH!");
    }
  });
}

const btnSaveSuhu = document.getElementById('btn-save-suhu');
if (btnSaveSuhu) {
  btnSaveSuhu.addEventListener('click', () => {
    if (!isAdmin) return;
    const minV = parseFloat(document.getElementById('in-min-suhu')?.value);
    const maxV = parseFloat(document.getElementById('in-max-suhu')?.value);
    if (!isNaN(minV) && !isNaN(maxV) && minV < maxV) {
      minSuhu = minV; maxSuhu = maxV;
      localStorage.setItem('minSuhu', minSuhu);
      localStorage.setItem('maxSuhu', maxSuhu);
      renderRangeLabels();
      kirimKontrolKeServer({ action: "set_target", min_suhu: minSuhu, max_suhu: maxSuhu, auth_key: ADMIN_PASSWORD_BENAR });
      alert("✅ Rentang Suhu berhasil disimpan!");
    } else {
      alert("⚠️ Nilai Min Suhu harus lebih kecil dari Max Suhu!");
    }
  });
}

// ==============================================================
// 5. INISIALISASI GRAFIK CHART.JS (3 DATASET)
// ==============================================================
let historyData = [];
const chartCanvas = document.getElementById('sensorChart');
let sensorChart = null;

if (chartCanvas) {
  const ctx = chartCanvas.getContext('2d');
  sensorChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'pH Air', borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.08)', fill: true, data: [], tension: 0.35, pointRadius: 2, yAxisID: 'y' },
        { label: 'Nutrisi (ppm)', borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, data: [], tension: 0.35, pointRadius: 2, yAxisID: 'y1' },
        { label: 'Suhu (°C)', borderColor: '#f59e0b', data: [], tension: 0.35, pointRadius: 2, yAxisID: 'y' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b9bb4', boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8b9bb4', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.1)' } },
        y: { type: 'linear', position: 'left', ticks: { color: '#8b9bb4', font: { size: 10 } }, grid: { color: 'rgba(148,163,184,0.1)' } },
        y1: { type: 'linear', position: 'right', ticks: { color: '#10b981', font: { size: 10 } }, grid: { drawOnChartArea: false } }
      }
    }
  });
}

// ==============================================================
// 6. UPDATE DATA TELEMETRI & INDIKATOR VISUAL
// ==============================================================
function updateSensorData(suhu, ph, ec, statusDiag = "NORMAL", waktuAsliSheets = null) {
  const boxPh = document.getElementById('box-ph');
  const boxEc = document.getElementById('box-ec');
  const boxSuhu = document.getElementById('box-suhu');

  if (boxPh) boxPh.style.borderColor = "var(--border)";
  if (boxEc) boxEc.style.borderColor = "var(--border)";
  if (boxSuhu) boxSuhu.style.borderColor = "var(--border)";

  const elValPh = document.getElementById('val-ph');
  const elValEc = document.getElementById('val-ec');
  const elValSuhu = document.getElementById('val-suhu');

  if (elValPh) elValPh.innerText = Number(ph).toFixed(2);
  if (elValEc) elValEc.innerText = Math.round(Number(ec));
  if (elValSuhu) elValSuhu.innerText = Number(suhu).toFixed(1);

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

  // Format Waktu Berdasarkan Timestamp Spreadsheet
  let dateObj = new Date();
  if (waktuAsliSheets) {
    const parsed = new Date(waktuAsliSheets);
    if (!isNaN(parsed.getTime())) dateObj = parsed;
  }

  const tglWaktu = `${dateObj.toLocaleDateString('id-ID')} ${dateObj.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
  const jamSaja = dateObj.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' });

  historyData.push({ fullTime: tglWaktu, time: jamSaja, ph: Number(ph), ec: Number(ec), suhu: Number(suhu), status: statusDiag });

  const logCounter = document.getElementById('log-counter');
  if (logCounter) logCounter.innerText = `Data Terekam: ${historyData.length} sampel`;

  if (sensorChart) {
    const recent = historyData.slice(-15);
    sensorChart.data.labels = recent.map(i => i.time);
    sensorChart.data.datasets[0].data = recent.map(i => i.ph);
    sensorChart.data.datasets[1].data = recent.map(i => i.ec);
    sensorChart.data.datasets[2].data = recent.map(i => i.suhu);
    sensorChart.update();
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
  if (cardEl) {
    cardEl.className = isOn ? "bubble-card relay-card active-glow" : "bubble-card relay-card";
  }
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
  if (cardEl) {
    cardEl.className = isOn ? "circulation-card bubble-card active-flow" : "circulation-card bubble-card";
  }
}

function tandaiEspOffline(selisihDetik, waktuTerakhir) {
  const badge = document.getElementById('overall-badge');
  if (badge) {
    badge.className = "badge-pill danger";
    const menitLalu = Math.floor(selisihDetik / 60);
    badge.innerText = menitLalu > 0 
      ? `🔴 ESP32 OFFLINE (Terputus ${menitLalu} mnt lalu)` 
      : `🔴 ESP32 OFFLINE (${selisihDetik} dtk lalu)`;
  }

  const setDim = (id, val) => { const el = document.getElementById(id); if (el) el.style.opacity = val; };
  setDim('val-ph', "0.45");
  setDim('val-ec', "0.45");
  setDim('val-suhu', "0.45");

  updatePumpUI('a', false);
  updatePumpUI('b', false);
  updatePumpUI('ph', false);
  updateCirculationUI(false);
}

function kembalikanStatusOnline() {
  const setNormal = (id) => { const el = document.getElementById(id); if (el) el.style.opacity = "1.0"; };
  setNormal('val-ph');
  setNormal('val-ec');
  setNormal('val-suhu');
}

// ==============================================================
// 7. POLLING REAL-TIME DARI GOOGLE APPS SCRIPT
// ==============================================================
let lastRecordedTimestamp = null;

async function fetchLatestFromSheets() {
  if (!GAS_URL || !GAS_URL.startsWith("https://")) return;

  try {
    const response = await fetch(`${GAS_URL}?action=read_latest`, {
      method: "GET",
      redirect: "follow"
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
    const json = await response.json();

    if (json.status === "success" && json.data) {
      console.log("[DATA SHEETS TERBACA]:", json.data);

      // Cek apakah data benar-benar baru sebelum di-append ke grafik
      if (json.data.waktu !== lastRecordedTimestamp) {
        lastRecordedTimestamp = json.data.waktu;
        updateSensorData(
          json.data.suhu, 
          json.data.ph, 
          json.data.ppm, 
          json.data.err_sensor, 
          json.data.waktu
        );
      } else {
        // Jika data sama, tetap perbarui kartu angka tanpa menambah titik grafik baru
        const elValPh = document.getElementById('val-ph');
        const elValEc = document.getElementById('val-ec');
        const elValSuhu = document.getElementById('val-suhu');
        if (elValPh) elValPh.innerText = Number(json.data.ph).toFixed(2);
        if (elValEc) elValEc.innerText = Math.round(Number(json.data.ppm));
        if (elValSuhu) elValSuhu.innerText = Number(json.data.suhu).toFixed(1);
      }

      // Sinkronkan status sakelar mode & pompa dari spreadsheet
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

      // Deteksi Heartbeat ESP32 (Toleransi 120 detik)
      const waktuServer = new Date(json.data.waktu).getTime();
      const waktuSekarang = Date.now();
      
      if (!isNaN(waktuServer)) {
        const selisihDetik = Math.abs(Math.floor((waktuSekarang - waktuServer) / 1000));
        if (selisihDetik <= 120) {
          kembalikanStatusOnline();
        } else {
          tandaiEspOffline(selisihDetik, json.data.waktu);
        }
      } else {
        kembalikanStatusOnline();
      }
    }
  } catch (err) {
    console.error("Gagal sinkronisasi data dari Google Sheets:", err);
  }
}

// Mulai polling langsung saat web dibuka, lalu ulangi setiap 6 detik
fetchLatestFromSheets();
setInterval(fetchLatestFromSheets, 6000);

// ==============================================================
// 8. EKSPOR DATA SENSOR (CSV)
// ==============================================================
const btnDownload = document.getElementById('btn-download');
if (btnDownload) {
  btnDownload.addEventListener('click', () => {
    if (historyData.length === 0) {
      alert("Belum ada data sensor yang terekam.");
      return;
    }
    let csv = "data:text/csv;charset=utf-8,Tanggal & Waktu,pH,Nutrisi TDS (ppm),Suhu (C),Diagnosa Sensor\n";
    historyData.forEach(r => {
      csv += `"${r.fullTime}",${r.ph},${r.ec},${r.suhu},"${r.status}"\n`;
    });
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Log_Hidroponik_Pakcoy_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
}
