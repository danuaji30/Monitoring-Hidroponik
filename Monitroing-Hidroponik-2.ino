/*
 * ============================================================
 *  MONITORING HIDROPONIK - ESP32-WROOM (OPTIMIZED)
 * ============================================================
 *  Sensor : DS18B20 (Suhu), pH Analog, EC/TDS Analog
 *  Koneksi: ESP -> Wifi -> Spreadsheet -> HTML
 *  Kontrol: 3 Pompa (Nutrisi A dan B serta Pompa pH) - Otomatis/Manual
 * ============================================================
 */
#include <Arduino.h>
#include <WiFi.h>
#include "esp_wifi.h"
#include "esp_eap_client.h"     // Pengganti modern esp_wpa2.h untuk WPA2-Enterprise
#include "esp_http_client.h"    // Library native HTTP ESP-IDF (hemat RAM & non-blocking)

#include <OneWire.h>
#include <DallasTemperature.h>

// ================= 1. KONFIGURASI GOOGLE APPS SCRIPT =================
// Tempelkan URL Web App Deployment Google Apps Script Anda (akhiran /exec)
const char* GAS_URL = "https://script.google.com/macros/s/PASTE_DEPLOYMENT_ID_ANDA/exec";

// ================= 2. DEFINISI PIN HARDWARE =================
// Konfigurasi pin berikut dioptimalkan untuk ESP32-S3 (ADC1 di GPIO 1-10).
// *Catatan untuk ESP32 WROOM-32 biasa: Ganti DS18B20=4, PH=34, EC=35, TRANS=26, PA=27, PB=25, PPH=14.
#define PIN_DS18B20     6   // Data DS18B20 (OneWire)
#define PIN_SENSOR_PH   4   // Analog pH (ADC1 GPIO 4)
#define PIN_SENSOR_EC   5   // Analog EC / TDS (ADC1 GPIO 5)
#define PIN_TRANS_EC    7   // Basis Transistor NPN pemutus GND probe EC

#define PIN_POMPA_A     15  // Relay Pompa Pekatan A
#define PIN_POMPA_B     16  // Relay Pompa Pekatan B
#define PIN_POMPA_PH    17  // Relay Pompa Penstabil pH

#define POMPA_C_ADALAH_PH_DOWN false // Ubah ke 'true' jika memakai larutan pH Down

// ================= 3. STRUKTUR DATA SHARED & MUTEX FREERTOS =================
SemaphoreHandle_t dataMutex;

struct SharedSystemState {
  // Data Sensor Terfilter
  float suhu = 25.0f;
  float ph   = 7.0f;
  float ppm  = 0.0f;
  bool sensorValid = true;          // Flag fail-safe: false jika sensor anomali
  String errSensor = "NORMAL";

  // Batas Acuan Target Pakcoy (Dapat disinkronkan dari Web/Sheets)
  float minPpm  = 1000.0f;
  float maxPpm  = 1200.0f;
  float minPh   = 5.80f;
  float maxPh   = 6.20f;
  float minSuhu = 22.0f;
  float maxSuhu = 28.0f;

  // Status Kontrol Pompa & Mode Operasi
  bool modeOtomatis = true;
  bool pompaA  = false;
  bool pompaB  = false;
  bool pompaPh = false;

  // Pemicu Pengiriman Event-Driven ke Sheets
  bool triggerKirimSheets = false;
} sysData;

OneWire oneWire(PIN_DS18B20);
DallasTemperature sensors(&oneWire);

// Parameter Waktu & Dosing Presisi
const uint16_t DURASI_POMPA_ON  = 3000;   // Dosing aktif 3 detik
const uint32_t JEDA_ADUK_DOSING = 60000;  // 60 detik jeda sirkulasi air sebelum dosing ulang
const float teganganPhNetral    = 1.65f;
const float faktorKalibrasiEC   = 1.0f;

// Variabel Konfigurasi Wi-Fi via Serial Monitor
String wifiType = "";
String ssid = "";
String username = "";
String wifiPassword = "";

// ================= 4. FUNGSI PEMBACAAN INPUT SERIAL =================
String readSerialInput() {
  while (Serial.available() == 0) {
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  String input = Serial.readStringUntil('\n');
  input.trim();
  return input;
}

// ================= 5. PENGIRIMAN DATA KE GOOGLE SHEETS (NATIVE ESP-IDF) =================
bool kirimKeSheetsAman(float suhu, float ph, float ppm, bool pA, bool pB, bool pPh, String errSensor) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println(F("[HTTP-ERR] Wi-Fi terputus! Data dilewati agar CPU tidak macet."));
    return false;
  }

  // Susun payload JSON ringkas
  String jsonPayload = "{"
    "\"suhu\":" + String(suhu, 1) + ","
    "\"ph\":" + String(ph, 2) + ","
    "\"ppm\":" + String((int)ppm) + ","
    "\"pompa_a\":" + (pA ? "true" : "false") + ","
    "\"pompa_b\":" + (pB ? "true" : "false") + ","
    "\"pompa_ph\":" + (pPh ? "true" : "false") + ","
    "\"err_sensor\":\"" + errSensor + "\""
  "}";

  esp_http_client_config_t config = {};
  config.url = GAS_URL;
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = 4500;                // Timeout 4.5 detik (mencegah task freeze)
  config.max_redirection_count = 5;        // Menangani HTTP 302 Redirect Google Apps Script
  config.skip_cert_common_name_check = true;

  esp_http_client_handle_t client = esp_http_client_init(&config);
  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_post_field(client, jsonPayload.c_str(), jsonPayload.length());

  esp_err_t err = esp_http_client_perform(client);
  bool sukses = false;

  if (err == ESP_OK) {
    int statusCode = esp_http_client_get_status_code(client);
    if (statusCode == 200 || statusCode == 302) {
      Serial.printf("[HTTP-OK] Data tersimpan di Google Sheets (Status: %d)\n", statusCode);
      sukses = true;
    } else {
      Serial.printf("[HTTP-ERR] Respon server tidak lazim: %d\n", statusCode);
    }
  } else {
    Serial.printf("[HTTP-ERR] Gagal perform HTTP: %s\n", esp_err_to_name(err));
  }

  // Wajib bersihkan resource handle untuk mencegah memory leak
  esp_http_client_cleanup(client);
  return sukses;
}

// ================= 6. VALIDASI DATA & FILTER SENSOR =================
float bacaTeganganRataRata(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t i = 0; i < 20; i++) {
    total += analogRead(pin);
    vTaskDelay(pdMS_TO_TICKS(8));
  }
  return (total / 20.0f) * (3.3f / 4095.0f);
}

void ambilDanValidasiSensor(float &suhuAir, float &nilaiPH, float &nilaiPPM, bool &isValid, String &diagnosa) {
  isValid = true;
  diagnosa = "NORMAL";

  // 1. Validasi Sensor Suhu DS18B20
  sensors.requestTemperatures();
  suhuAir = sensors.getTempCByIndex(0);
  if (suhuAir <= -100.0f || suhuAir >= 84.9f) {
    suhuAir = 25.0f; // Nilai default darurat agar kompensasi suhu EC tidak rusak
    isValid = false;
    diagnosa = "ERR_DS18B20_OFFLINE";
  }

  // 2. Validasi Sensor pH (GND EC diputus via Transistor NPN untuk cegah interferensi)
  digitalWrite(PIN_TRANS_EC, LOW);
  vTaskDelay(pdMS_TO_TICKS(150));
  float vPH = bacaTeganganRataRata(PIN_SENSOR_PH);
  nilaiPH = 7.0f + ((teganganPhNetral - vPH) / 0.18f);

  if (nilaiPH < 3.0f || nilaiPH > 10.5f) {
    isValid = false;
    diagnosa = (diagnosa == "NORMAL") ? "ERR_PH_ANOMALI" : diagnosa + "|ERR_PH";
  }

  // 3. Validasi Sensor EC / PPM (GND EC diaktifkan sementara)
  digitalWrite(PIN_TRANS_EC, HIGH);
  vTaskDelay(pdMS_TO_TICKS(250));
  float vEC = bacaTeganganRataRata(PIN_SENSOR_EC);
  digitalWrite(PIN_TRANS_EC, LOW); // Langsung putus kembali

  float vKomp = vEC / (1.0f + 0.02f * (suhuAir - 25.0f));
  float tdsPpm = (133.42f * vKomp * vKomp * vKomp 
                - 255.86f * vKomp * vKomp 
                + 857.39f * vKomp) * 0.5f;
  nilaiPPM = tdsPpm * faktorKalibrasiEC;

  if (nilaiPPM <= 30.0f) {
    isValid = false; // Probe tidak tercelup atau tandon kosong
    diagnosa = (diagnosa == "NORMAL") ? "WARN_TANDON_KERING_EC" : diagnosa + "|WARN_EC";
  }
}

// ================= 7. TASK CORE 1: SENSOR & KONTROL FAIL-SAFE =================
void TaskSensorAndControl(void *pvParameters) {
  uint32_t prevSensorTick = 0;
  bool sedangDosingAB = false;
  bool sedangDosingPH = false;
  uint32_t waktuMulaiAB = 0, waktuTerakhirAB = 0;
  uint32_t waktuMulaiPH = 0, waktuTerakhirPH = 0;

  for (;;) {
    uint32_t now = millis();

    bool isAuto, manA, manB, manPh;
    float minPpm, minPh, maxPh;
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      isAuto = sysData.modeOtomatis;
      manA   = sysData.pompaA;
      manB   = sysData.pompaB;
      manPh  = sysData.pompaPh;
      minPpm = sysData.minPpm;
      minPh  = sysData.minPh;
      maxPh  = sysData.maxPh;
      xSemaphoreGive(dataMutex);
    }

    // --- A. TIMER PEMUTUS POMPA OTOMATIS (PRESISI 3 DETIK) ---
    if (isAuto) {
      if (sedangDosingAB && (now - waktuMulaiAB >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_A, LOW);
        digitalWrite(PIN_POMPA_B, LOW);
        sedangDosingAB = false;
        waktuTerakhirAB = now;
        Serial.println(F("[CORE 1] Dosing Nutrisi A & B 3 detik selesai (OFF)."));

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaA = false;
          sysData.pompaB = false;
          sysData.triggerKirimSheets = true;
          xSemaphoreGive(dataMutex);
        }
      }

      if (sedangDosingPH && (now - waktuMulaiPH >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_PH, LOW);
        sedangDosingPH = false;
        waktuTerakhirPH = now;
        Serial.println(F("[CORE 1] Dosing Penstabil pH 3 detik selesai (OFF)."));

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaPh = false;
          sysData.triggerKirimSheets = true;
          xSemaphoreGive(dataMutex);
        }
      }
    } else {
      // --- MODE MANUAL: IKUTI PERINTAH WEB ---
      sedangDosingAB = false;
      sedangDosingPH = false;
      digitalWrite(PIN_POMPA_A, manA ? HIGH : LOW);
      digitalWrite(PIN_POMPA_B, manB ? HIGH : LOW);
      digitalWrite(PIN_POMPA_PH, manPh ? HIGH : LOW);
    }

    // --- B. PEMBACAAN DAN EVALUASI SENSOR TIAP 2.5 DETIK ---
    if (now - prevSensorTick >= 2500 || prevSensorTick == 0) {
      prevSensorTick = now;
      float s, p, ecPpm;
      bool sensorSehat;
      String diag;
      ambilDanValidasiSensor(s, p, ecPpm, sensorSehat, diag);

      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        sysData.suhu = s;
        sysData.ph   = p;
        sysData.ppm  = ecPpm;
        sysData.sensorValid = sensorSehat;
        sysData.errSensor   = diag;
        xSemaphoreGive(dataMutex);
      }

      // --- C. LOGIKA FAIL-SAFE & DOSING OTOMATIS ---
      if (isAuto) {
        // Proteksi: JANGAN izinkan dosing jika ada sensor yang anomali
        if (!sensorSehat) {
          if (sedangDosingAB || sedangDosingPH) {
            digitalWrite(PIN_POMPA_A, LOW);
            digitalWrite(PIN_POMPA_B, LOW);
            digitalWrite(PIN_POMPA_PH, LOW);
            sedangDosingAB = false;
            sedangDosingPH = false;
          }
          Serial.printf("[FAIL-SAFE] Dosing DITAHAN! Status: %s\n", diag.c_str());
        } else {
          // Sensor normal, jalankan otomasi
          uint32_t currentNow = millis();
          bool jedaABSelesai = (currentNow - waktuTerakhirAB >= JEDA_ADUK_DOSING) || (waktuTerakhirAB == 0);
          if (!sedangDosingAB && jedaABSelesai && (ecPpm < minPpm)) {
            digitalWrite(PIN_POMPA_A, HIGH);
            digitalWrite(PIN_POMPA_B, HIGH);
            sedangDosingAB = true;
            waktuMulaiAB = currentNow;
            Serial.println(F("[CORE 1] PPM rendah -> Pompa A & B aktif 3 detik..."));

            if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
              sysData.pompaA = true;
              sysData.pompaB = true;
              sysData.triggerKirimSheets = true;
              xSemaphoreGive(dataMutex);
            }
          }

          bool jedaPhSelesai = (currentNow - waktuTerakhirPH >= JEDA_ADUK_DOSING) || (waktuTerakhirPH == 0);
          bool butuhPh = POMPA_C_ADALAH_PH_DOWN ? (p > maxPh) : (p < minPh);
          if (!sedangDosingPH && jedaPhSelesai && butuhPh) {
            digitalWrite(PIN_POMPA_PH, HIGH);
            sedangDosingPH = true;
            waktuMulaiPH = currentNow;
            Serial.println(F("[CORE 1] pH di luar target -> Pompa pH aktif 3 detik..."));

            if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
              sysData.pompaPh = true;
              sysData.triggerKirimSheets = true;
              xSemaphoreGive(dataMutex);
            }
          }
        }
      }
    }

    vTaskDelay(pdMS_TO_TICKS(20)); // Mencegah watchdog timeout pada Core 1
  }
}

// ================= 8. TASK CORE 0: SINKRONISASI GOOGLE SHEETS =================
void TaskSheetsSync(void *pvParameters) {
  uint32_t prevSendTick = 0;
  const uint32_t INTERVAL_PERIODIK = 30000; // Kirim telemetri berkala setiap 30 detik

  for (;;) {
    uint32_t now = millis();
    bool kirimSekarang = false;
    float s, p, ppm;
    bool pA, pB, pPh;
    String err;

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (sysData.triggerKirimSheets || (now - prevSendTick >= INTERVAL_PERIODIK) || (prevSendTick == 0)) {
        kirimSekarang = true;
        sysData.triggerKirimSheets = false;

        s   = sysData.suhu;
        p   = sysData.ph;
        ppm = sysData.ppm;
        pA  = sysData.pompaA;
        pB  = sysData.pompaB;
        pPh = sysData.pompaPh;
        err = sysData.errSensor;
      }
      xSemaphoreGive(dataMutex);
    }

    if (kirimSekarang) {
      prevSendTick = now;
      kirimKeSheetsAman(s, p, ppm, pA, pB, pPh, err);
    }

    vTaskDelay(pdMS_TO_TICKS(100)); // Beri ruang bagi background process Wi-Fi
  }
}

// ================= 9. SETUP & LOOP =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  // Inisialisasi Pin Relay Pompa & Transistor
  pinMode(PIN_TRANS_EC, OUTPUT);
  pinMode(PIN_POMPA_A, OUTPUT);
  pinMode(PIN_POMPA_B, OUTPUT);
  pinMode(PIN_POMPA_PH, OUTPUT);

  digitalWrite(PIN_TRANS_EC, LOW);
  digitalWrite(PIN_POMPA_A, LOW);
  digitalWrite(PIN_POMPA_B, LOW);
  digitalWrite(PIN_POMPA_PH, LOW);

  analogReadResolution(12);
  sensors.begin();

  // --- MENU KONEKSI WI-FI INTERAKTIF VIA SERIAL ---
  Serial.println(F("\n\n=========================================="));
  Serial.println(F("   KONFIGURASI JARINGAN WI-FI ESP32"));
  Serial.println(F("=========================================="));
  Serial.println(F("1. Wi-Fi Biasa (Rumah / Hotspot HP)"));
  Serial.println(F("2. Wi-Fi WPA2 Enterprise (Kampus / IPB-ACCESS)"));
  Serial.print(F("Pilih mode jaringan (ketik 1 atau 2): "));

  wifiType = readSerialInput();
  Serial.println(wifiType);

  if (wifiType == "1") {
    // Mode Wi-Fi Standar
    Serial.print(F("Masukkan SSID Wi-Fi: "));
    ssid = readSerialInput();
    Serial.println(ssid);

    Serial.print(F("Masukkan Password Wi-Fi: "));
    wifiPassword = readSerialInput();
    Serial.println(F("********"));

    Serial.printf("\nMenghubungkan ke Wi-Fi [%s]...\n", ssid.c_str());
    WiFi.begin(ssid.c_str(), wifiPassword.c_str());

  } else if (wifiType == "2") {
    // Mode WPA2-Enterprise Modern
    Serial.print(F("Masukkan SSID (misal: IPB-ACCESS): "));
    ssid = readSerialInput();
    Serial.println(ssid);

    Serial.print(F("Masukkan Username (NIM / Email ID): "));
    username = readSerialInput();
    Serial.println(username);

    Serial.print(F("Masukkan Password Akun: "));
    wifiPassword = readSerialInput();
    Serial.println(F("********"));

    Serial.printf("\nMenghubungkan ke Enterprise [%s]...\n", ssid.c_str());
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);

    esp_eap_client_set_identity((uint8_t *)username.c_str(), username.length());
    esp_eap_client_set_username((uint8_t *)username.c_str(), username.length());
    esp_eap_client_set_password((uint8_t *)wifiPassword.c_str(), wifiPassword.length());
    esp_wifi_sta_enterprise_enable();

    WiFi.begin(ssid.c_str());
  } else {
    Serial.println(F("Pilihan tidak valid! Silakan tekan tombol RST/EN pada ESP32."));
    while (true);
  }

  // Loop Menunggu Koneksi Tersambung (Timeout 30 detik)
  int timeoutCounter = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(F("."));
    timeoutCounter++;
    if (timeoutCounter > 60) {
      Serial.println(F("\n[KONEKSI GAGAL] Periksa kembali kredensial atau jangkauan sinyal."));
      while (true);
    }
  }

  Serial.println(F("\n\n=========================================="));
  Serial.println(F("       WI-FI BERHASIL TERHUBUNG!         "));
  Serial.println(F("=========================================="));
  Serial.print(F("Alamat IP ESP32: "));
  Serial.println(WiFi.localIP());

  // Inisialisasi Mutex FreeRTOS
  dataMutex = xSemaphoreCreateMutex();

  // Task Sensor & Kontrol Dosing di Core 1 (Prioritas 2)
  xTaskCreatePinnedToCore(
    TaskSensorAndControl,
    "SensorControlTask",
    4096,
    NULL,
    2,
    NULL,
    1
  );

  // Task Jaringan & Google Sheets di Core 0 (Prioritas 1, Stack 8KB untuk TLS/HTTPS)
  xTaskCreatePinnedToCore(
    TaskSheetsSync,
    "SheetsSyncTask",
    8192,
    NULL,
    1,
    NULL,
    0
  );
}

void loop() {
  // Task loop Arduino dihapus dari penjadwal FreeRTOS untuk menghemat memori
  vTaskDelete(NULL);
}
