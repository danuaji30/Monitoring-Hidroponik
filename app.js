// ==============================================================
// 1. KONFIGURASI WEB APP GOOGLE APPS SCRIPT
// ==============================================================
const GAS_URL = "https://script.google.com/macros/s/AKfycbycOnRCQqVl65n79biPf16Q5UyLYrsL3NA8q0HJ1id08539OoLeZnmuwW8EGrXqgjQz/exec";
const ADMIN_PASSWORD_BENAR = "sibibikinpusing";

// ==============================================================
// 2. JAM REAL-TIME & TEMA TERANG / GELAP
// ==============================================================
const htmlEl = document.documentElement;
const btnTheme = document.getElementById('btn-theme');
btnTheme.addEventListener('click', () => {
  const isDark = htmlEl.getAttribute('data-theme') === 'dark';
  htmlEl.setAttribute('data-theme', isDark ? 'light' : 'dark');
  btnTheme.innerText = isDark ? '🌙' : '☀️';
});

function updateClock() {
  const now = new Date();
  const opsiTgl = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' };
  const opsiJam = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' };
  document.getElementById('rt-date').innerText = now.toLocaleDateString('id-ID', opsiTgl).toUpperCase();
  document.getElementById('rt-time').innerText = now.toLocaleTimeString('id-ID', opsiJam);
}
setInterval(updateClock, 1000);
updateClock();

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
  const canControlDosing = isAdmin && !toggleMode.checked;
  toggleA.disabled = !canControlDosing;
  toggleB.disabled = !canControlDosing;
  togglePh.disabled = !canControlDosing;
  toggleCirc.disabled = !isAdmin;
}

function setAdminMode(status) {
  isAdmin = status;
  adminElements.forEach(el => {
    if (status) el.classList.remove('locked');
    else el.classList.add('locked');
  });
  toggleMode.disabled = !status;
  updateDosingInputsState();

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

if (sessionStorage.getItem('hydroAdminLoggedIn') === 'true') {
  setAdminMode(true);
}

btnAuth.addEventListener('click', () => {
  if (isAdmin) {
    if (confirm("Logout dari mode Admin?")) setAdminMode(false);
  } else {
    modalLogin.classList.add('show');
    loginError.style.display = 'none';
    document.getElementById('login-pass').value = '';
    document.getElementById('login-pass').focus();
  }
});

btnLoginCancel.addEventListener('click', () => modalLogin.classList.remove('show'));
modalLogin.addEventListener('click', (e) => { if (e.target === modalLogin) modalLogin.classList.remove('show'); });

btnLoginSubmit.addEventListener('click', () => {
  const pass = document.getElementById('login-pass').value;
  if (pass === ADMIN_PASSWORD_BENAR) {
    setAdminMode(true);
    modalLogin.classList.remove('show');
  } else {
    loginError.style.display = 'block';
  }
});
document.getElementById('login-pass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnLoginSubmit.click();
});

function kirimKontrolKeServer(payload) {
  if (!GAS_URL.includes("http")) {
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
toggleMode.addEventListener('change', (e) => {
  if (!isAdmin) return;
  const isAuto = e.target.checked;
  document.getElementById('txt-mode').innerText = isAuto ? "Otomasi Dosing" : "Mode Manual";
  updateDosingInputsState();
  kirimKontrolKeServer({ action: "set_mode", otomatis: isAuto, auth_key: ADMIN_PASSWORD_BENAR });
});

toggleA.addEventListener('change', (e) => {
  if (!isAdmin || toggleMode.checked) return;
  updatePumpUI('a', e.target.checked);
  kirimKontrolKeServer({ action: "set_pump", target: "pompa_a", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
});

toggleB.addEventListener('change', (e) => {
  if (!isAdmin || toggleMode.checked) return;
  updatePumpUI('b', e.target.checked);
  kirimKontrolKeServer({ action: "set_pump", target: "pompa_b", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
});

togglePh.addEventListener('change', (e) => {
  if (!isAdmin || toggleMode.checked) return;
  updatePumpUI('ph', e.target.checked);
  kirimKontrolKeServer({ action: "set_pump", target: "pompa_ph", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
});

toggleCirc.addEventListener('change', (e) => {
  if (!isAdmin) return;
  updateCirculationUI(e.target.checked);
  kirimKontrolKeServer({ action: "set_pump", target: "pompa_sirkulasi", state: e.target.checked, auth_key: ADMIN_PASSWORD_BENAR });
});

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
  document.getElementById('in-min-ec').value = minEc;
  document.getElementById('in-max-ec').value = maxEc;
  document.getElementById('in-min-ph').value = minPh;
  document.getElementById('in-max-ph').value = maxPh;
  document.getElementById('in-min-suhu').value = minSuhu;
  document.getElementById('in-max-suhu').value = maxSuhu;

  document.getElementById('lbl-range-ec').innerText = `${minEc} - ${maxEc}`;
  document.getElementById('lbl-range-ph').innerText = `${minPh.toFixed(1)} - ${maxPh.toFixed(1)}`;
  document.getElementById('lbl-range-suhu').innerText = `${minSuhu.toFixed(1)} - ${maxSuhu.toFixed(1)}`;
}
renderRangeLabels();

document.getElementById('btn-save-ec').addEventListener('click', () => {
  if (!isAdmin) return;
  const minV = parseFloat(document.getElementById('in-min-ec').value);
  const maxV = parseFloat(document.getElementById('in-max-ec').value);
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

document.getElementById('btn-save-ph').addEventListener('click', () => {
  if (!isAdmin) return;
  const minV = parseFloat(document.getElementById('in-min-ph').value);
  const maxV = parseFloat(document.getElementById('in-max-ph').value);
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

document.getElementById('btn-save-suhu').addEventListener('click', () => {
  if (!isAdmin) return;
  const minV = parseFloat(document.getElementById('in-min-suhu').value);
  const maxV = parseFloat(document.getElementById('in-max-suhu').value);
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

// ==============================================================
// 5. INISIALISASI GRAFIK CHART.JS (3 DATASET)
// ==============================================================
let historyData = [];
const ctx = document.getElementById('sensorChart').getContext('2d');
const sensorChart = new Chart(ctx, {
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

// ==============================================================
// 6. UPDATE DATA TELEMETRI & INDIKATOR VISUAL
// ==============================================================
function updateSensorData(suhu, ph, ec, statusDiag = "NORMAL", waktuAsliSheets = null) {
  const boxPh = document.getElementById('box-ph');
  const boxEc = document.getElementById('box-ec');
  const boxSuhu = document.getElementById('box-suhu');

  boxPh.style.borderColor = "var(--border)";
  boxEc.style.borderColor = "var(--border)";
  boxSuhu.style.borderColor = "var(--border)";

  document.getElementById('val-ph').innerText = Number(ph).toFixed(2);
  document.getElementById('val-ec').innerText = Math.round(Number(ec));
  document.getElementById('val-suhu').innerText = Number(suhu).toFixed(1);

  const badge = document.getElementById('overall-badge');

  if (statusDiag !== "NORMAL") {
    badge.innerText = `⚠️ ANOMALI: ${statusDiag}`;
    badge.className = "badge-pill danger";

    if (statusDiag.includes("PH")) boxPh.style.borderColor = "var(--accent-red)";
    if (statusDiag.includes("EC") || statusDiag.includes("KERING")) boxEc.style.borderColor = "var(--accent-amber)";
    if (statusDiag.includes("DS18B20")) boxSuhu.style.borderColor = "var(--accent-red)";
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

  // Waktu format: Gunakan waktu asli dari spreadsheet jika tersedia
  const dateObj = waktuAsliSheets ? new Date(waktuAsliSheets) : new Date();
  const tglWaktu = `${dateObj.toLocaleDateString('id-ID')} ${dateObj.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' })}`;
  const jamSaja = dateObj.toLocaleTimeString('id-ID', { hour12: false, timeZone: 'Asia/Jakarta' });

  historyData.push({ fullTime: tglWaktu, time: jamSaja, ph, ec, suhu, status: statusDiag });
  document.getElementById('log-counter').innerText = `Data Terekam: ${historyData.length} sampel`;

  // Plot grafik hanya jika ada penambahan titik baru
  const recent = historyData.slice(-15);
  sensorChart.data.labels = recent.map(i => i.time);
  sensorChart.data.datasets[0].data = recent.map(i => i.ph);
  sensorChart.data.datasets[1].data = recent.map(i => i.ec);
  sensorChart.data.datasets[2].data = recent.map(i => i.suhu);
  sensorChart.update();
}

function updatePumpUI(prefix, isOn) {
  document.getElementById(`toggle-${prefix}`).checked = isOn;
  document.getElementById(`dot-${prefix}`).className = isOn ? "dot on" : "dot";
  const txt = document.getElementById(`status-txt-${prefix}`);
  txt.innerText = isOn ? "Menyala" : "Mati";
  txt.style.color = isOn ? "var(--accent-green)" : "var(--text-muted)";
  document.getElementById(`card-${prefix}`).className = isOn ? "bubble-card relay-card active-glow" : "bubble-card relay-card";
}

function updateCirculationUI(isOn) {
  document.getElementById('toggle-circ').checked = isOn;
  document.getElementById('dot-circ').className = isOn ? "dot on-cyan" : "dot";
  const txt = document.getElementById('status-txt-circ');
  txt.innerText = isOn ? "Mengalir (Aktif)" : "Mati";
  txt.style.color = isOn ? "var(--accent-cyan)" : "var(--text-muted)";
  document.getElementById('card-circ').className = isOn ? "circulation-card bubble-card active-flow" : "circulation-card bubble-card";
}

// ==============================================================
// 7. POLLING REAL-TIME DARI GOOGLE APPS SCRIPT
// ==============================================================
let lastRecordedTimestamp = null; // Menyimpan waktu terakhir agar data duplikat tidak diplot ulang

async function fetchLatestFromSheets() {
  if (!GAS_URL.includes("http")) return;
  try {
    const response = await fetch(`${GAS_URL}?action=read_latest`);
    const json = await response.json();

    if (json.status === "success" && json.data) {
      const waktuServer = new Date(json.data.waktu).getTime();
      const waktuSekarang = Date.now();
      const selisihDetik = Math.floor((waktuSekarang - waktuServer) / 1000);

      // ESP32 normalnya mengirim tiap 30 detik. Beri toleransi 75 detik.
      if (isNaN(waktuServer) || selisihDetik > 75) {
        // --- KONDISI ESP32 MATI / OFFLINE ---
        tandaiEspOffline(selisihDetik, json.data.waktu);
        return;
      }

      // --- KONDISI ESP32 AKTIF (ONLINE) ---
      kembalikanStatusOnline();

      // Update status sakelar pompa sesuai pembacaan server
      updatePumpUI('a', json.data.pompa_a === "ON");
      updatePumpUI('b', json.data.pompa_b === "ON");
      updatePumpUI('ph', json.data.pompa_ph === "ON");
      updateCirculationUI(json.data.pompa_sirkulasi === "ON");

      // Cek apakah data ini benar-benar data baru (mencegah plot berulang)
      if (json.data.waktu !== lastRecordedTimestamp) {
        lastRecordedTimestamp = json.data.waktu;
        updateSensorData(
          json.data.suhu, 
          json.data.ph, 
          json.data.ppm, 
          json.data.err_sensor, 
          json.data.waktu // Teruskan waktu asli dari Sheets
        );
      }
    }
  } catch (e) {
    console.warn("Gagal sinkronisasi data dengan Google Sheets:", e);
  }
}

setInterval(fetchLatestFromSheets, 6000);

// ==============================================================
// 8. EKSPOR DATA SENSOR (CSV)
// ==============================================================
document.getElementById('btn-download').addEventListener('click', () => {
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

function tandaiEspOffline(selisihDetik, waktuTerakhir) {
  const badge = document.getElementById('overall-badge');
  badge.className = "badge-pill danger";
  
  const menitLalu = Math.floor(selisihDetik / 60);
  badge.innerText = menitLalu > 0 
    ? `🔴 ESP32 OFFLINE (Terputus ${menitLalu} mnt lalu)` 
    : `🔴 ESP32 OFFLINE (${selisihDetik} dtk lalu)`;

  // Beri indikasi visual redup pada angka pembacaan
  document.getElementById('val-ph').style.opacity = "0.45";
  document.getElementById('val-ec').style.opacity = "0.45";
  document.getElementById('val-suhu').style.opacity = "0.45";

  // Matikan indikator pompa sirkulasi & dosing
  updatePumpUI('a', false);
  updatePumpUI('b', false);
  updatePumpUI('ph', false);
  updateCirculationUI(false);
}

function kembalikanStatusOnline() {
  document.getElementById('val-ph').style.opacity = "1.0";
  document.getElementById('val-ec').style.opacity = "1.0";
  document.getElementById('val-suhu').style.opacity = "1.0";
}
