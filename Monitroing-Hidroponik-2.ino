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
#include "esp_eap_client.h"     // WPA2-Enterprise untuk ESP-IDF modern
#include "esp_http_client.h"    // HTTP Client Native ESP-IDF
#include "esp_crt_bundle.h"     // Root CA Bundle Google (Mengatasi SSL 0x8017)
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ================= 1. KONFIGURASI BACKEND & LOGIKA RELAY =================
const char* GAS_URL = "https://script.google.com/macros/s/AKfycbycOnRCQqVl65n79biPf16Q5UyLYrsL3NA8q0HJ1id08539OoLeZnmuwW8EGrXqgjQz/exec";

#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// ================= 2. PINOUT ESP32 30-PIN =================
#define PIN_DS18B20         4   // OneWire DS18B20 (+ Resistor Pull-up 4.7k ke 3V3)
#define PIN_SENSOR_PH       34  // ADC1_CH6 (Analog pH-4502C)
#define PIN_SENSOR_EC       35  // ADC1_CH7 (Analog Gravity TDS)
#define PIN_TRANS_EC        26  // Basis Transistor NPN (Sakelar GND TDS)

#define PIN_POMPA_A         27  // Relay Pompa Nutrisi A
#define PIN_POMPA_B         25  // Relay Pompa Nutrisi B
#define PIN_POMPA_PH        14  // Relay Pompa Penstabil pH
#define PIN_POMPA_SIRKULASI 13  // Relay Pompa Sirkulasi Utama

#define POMPA_C_ADALAH_PH_DOWN true

// ================= 3. STRUKTUR DATA SHARED & MUTEX =================
SemaphoreHandle_t dataMutex;

struct SharedSystemState {
  float suhu = 25.0f;
  float ph   = 7.00f;
  float ppm  = 0.0f;
  bool sensorValid = true;
  String errSensor = "NORMAL";

  float minPpm  = 1000.0f;
  float maxPpm  = 1200.0f;
  float minPh   = 5.80f;
  float maxPh   = 6.20f;
  float minSuhu = 22.0f;
  float maxSuhu = 28.0f;

  bool modeOtomatis    = true;
  bool pompaA          = false;
  bool pompaB          = false;
  bool pompaPh         = false;
  bool pompaSirkulasi  = true;

  bool triggerKirimSheets = false;
} sysData;

OneWire oneWire(PIN_DS18B20);
DallasTemperature sensors(&oneWire);

const uint16_t DURASI_POMPA_ON  = 3000;   // Dosing 3 detik
const uint32_t JEDA_ADUK_DOSING = 60000;  // Jeda sirkulasi 60 detik
const float TEGANGAN_PH_NETRAL  = 1.65f;  // Titik tengah trimpot pH-4502C pada ESP32
const float FAKTOR_KALIBRASI_EC = 1.0f;

// ================= 4. PEMBACAAN INPUT SERIAL WI-FI =================
String readSerialInput() {
  while (Serial.available() == 0) {
    vTaskDelay(pdMS_TO_TICKS(10));
  }
  String input = Serial.readStringUntil('\n');
  input.trim();
  return input;
}

// ================= 5. HTTP GET (BACA KONTROL DARI GOOGLE APPS SCRIPT) =================
esp_err_t _http_get_event_handler(esp_http_client_event_t *evt) {
  if (evt->event_id == HTTP_EVENT_ON_DATA) {
    String *buffer = (String *)evt->user_data;
    if (buffer != nullptr && evt->data != nullptr) {
      for (int i = 0; i < evt->data_len; i++) {
        *buffer += ((char *)evt->data)[i];
      }
    }
  }
  return ESP_OK;
}

bool bacaStatusKontrolDariSheets() {
  if (WiFi.status() != WL_CONNECTED) return false;

  String fullUrl = String(GAS_URL) + "?action=read_control";
  String responsePayload = "";
  responsePayload.reserve(512);

  esp_http_client_config_t config = {};
  config.url = fullUrl.c_str();
  config.method = HTTP_METHOD_GET;
  config.timeout_ms = 8000;
  config.max_redirection_count = 5;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.keep_alive_enable = false; // Hindari penumpukan soket
  config.event_handler = _http_get_event_handler;
  config.user_data = &responsePayload;

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == NULL) return false;

  esp_err_t err = esp_http_client_perform(client);
  bool sukses = false;

  if (err == ESP_OK) {
    int statusCode = esp_http_client_get_status_code(client);
    if (statusCode == 200 || statusCode == 302) {
      JsonDocument doc;
      DeserializationError dErr = deserializeJson(doc, responsePayload);

      if (!dErr && doc["status"] == "success") {
        JsonObject ctrl = doc["control"];
        bool isAuto = ctrl["otomatis"] | true;
        bool pA     = ctrl["pompa_a"] | false;
        bool pB     = ctrl["pompa_b"] | false;
        bool pPh    = ctrl["pompa_ph"] | false;
        bool pCirc  = ctrl["pompa_sirkulasi"] | true;

        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.modeOtomatis   = isAuto;
          sysData.pompaA         = pA;
          sysData.pompaB         = pB;
          sysData.pompaPh        = pPh;
          sysData.pompaSirkulasi = pCirc;
          xSemaphoreGive(dataMutex);
        }
        sukses = true;
      }
    }
  }

  // Wajib tutup dan bersihkan soket
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
  return sukses;
}

// ================= 6. HTTP POST (KIRIM TELEMETRI KE GOOGLE APPS SCRIPT) =================
bool kirimKeSheetsAman(float suhu, float ph, float ppm, bool pA, bool pB, bool pPh, bool pCirc, String errSensor) {
  if (WiFi.status() != WL_CONNECTED) return false;

  if (ESP.getFreeHeap() < 35000) {
    Serial.println(F("[HTTP WARN] Heap kritis! Pengiriman telemetri ditunda."));
    return false;
  }

  if (isnan(suhu) || isinf(suhu)) suhu = 25.0f;
  if (isnan(ph) || isinf(ph)) ph = 7.00f;
  if (isnan(ppm) || isinf(ppm) || ppm < 0) ppm = 0.0f;

  String jsonPayload = "{"
    "\"suhu\":" + String(suhu, 1) + ","
    "\"ph\":" + String(ph, 2) + ","
    "\"ppm\":" + String((int)ppm) + ","
    "\"pompa_a\":" + (pA ? "true" : "false") + ","
    "\"pompa_b\":" + (pB ? "true" : "false") + ","
    "\"pompa_ph\":" + (pPh ? "true" : "false") + ","
    "\"pompa_sirkulasi\":" + (pCirc ? "true" : "false") + ","
    "\"err_sensor\":\"" + errSensor + "\""
  "}";

  esp_http_client_config_t config = {};
  config.url = GAS_URL;
  config.method = HTTP_METHOD_POST;
  config.timeout_ms = 10000;
  config.max_redirection_count = 5;
  config.crt_bundle_attach = esp_crt_bundle_attach;
  config.keep_alive_enable = false; // Tutup koneksi segera setelah respon selesai

  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == NULL) return false;

  esp_http_client_set_header(client, "Content-Type", "application/json");
  esp_http_client_set_post_field(client, jsonPayload.c_str(), jsonPayload.length());

  esp_err_t err = esp_http_client_perform(client);
  bool sukses = false;

  if (err == ESP_OK) {
    int statusCode = esp_http_client_get_status_code(client);
    if (statusCode == 200 || statusCode == 302) {
      Serial.printf("[HTTP POST OK] Status: %d | Suhu: %.1f C | pH: %.2f | PPM: %d\n", statusCode, suhu, ph, (int)ppm);
      sukses = true;
    } else {
      Serial.printf("[HTTP POST WARN] Respon server: %d\n", statusCode);
    }
  } else {
    Serial.printf("[HTTP POST FAIL] Gagal: %s\n", esp_err_to_name(err));
  }

  // Wajib tutup soket fisik lwIP sebelum cleanup
  esp_http_client_close(client);
  esp_http_client_cleanup(client);
  return sukses;
}

// ================= 7. FILTERING & PEMBACAAN 3 SENSOR =================
float bacaTeganganPhMedian(uint8_t pin) {
  const int JUMLAH = 25;
  float b[JUMLAH];
  for (int i = 0; i < JUMLAH; i++) {
    b[i] = analogRead(pin) * (3.3f / 4095.0f);
    vTaskDelay(pdMS_TO_TICKS(5));
  }
  for (int i = 0; i < JUMLAH - 1; i++) {
    for (int j = i + 1; j < JUMLAH; j++) {
      if (b[i] > b[j]) { float t = b[i]; b[i] = b[j]; b[j] = t; }
    }
  }
  float sum = 0.0f;
  for (int i = 5; i < JUMLAH - 5; i++) sum += b[i];
  return sum / (JUMLAH - 10);
}

void ambilDanValidasiSensor(float &suhuAir, float &nilaiPH, float &nilaiPPM, bool &isValid, String &diagnosa) {
  isValid = true;
  diagnosa = "NORMAL";

  // 1. Suhu Air DS18B20
  sensors.requestTemperatures();
  suhuAir = sensors.getTempCByIndex(0);
  if (suhuAir <= -100.0f || suhuAir >= 84.9f) {
    suhuAir = 25.0f;
    isValid = false;
    diagnosa = "ERR_DS18B20_OFFLINE";
  }

  // 2. pH-4502C (Transistor EC OFF agar tidak ada arus bocor ke air)
  digitalWrite(PIN_TRANS_EC, LOW);
  vTaskDelay(pdMS_TO_TICKS(150));
  float vPH = bacaTeganganPhMedian(PIN_SENSOR_PH);
  nilaiPH = 7.0f + ((TEGANGAN_PH_NETRAL - vPH) / 0.18f);

  if (nilaiPH < 3.0f || nilaiPH > 10.5f) {
    isValid = false;
    diagnosa = (diagnosa == "NORMAL") ? "ERR_PH_ANOMALI" : diagnosa + "|ERR_PH";
  }

  // 3. Gravity TDS (Transistor NPN ON sesaat untuk pembacaan)
  digitalWrite(PIN_TRANS_EC, HIGH);
  vTaskDelay(pdMS_TO_TICKS(250));
  float vEC = analogRead(PIN_SENSOR_EC) * (3.3f / 4095.0f);
  digitalWrite(PIN_TRANS_EC, LOW);

  float vKomp = vEC / (1.0f + 0.02f * (suhuAir - 25.0f));
  float tdsPpm = (133.42f * vKomp * vKomp * vKomp - 255.86f * vKomp * vKomp + 857.39f * vKomp) * 0.5f;
  nilaiPPM = tdsPpm * FAKTOR_KALIBRASI_EC;
  if (nilaiPPM < 0.0f) nilaiPPM = 0.0f;

  if (nilaiPPM <= 30.0f) {
    isValid = false;
    diagnosa = (diagnosa == "NORMAL") ? "WARN_TANDON_KERING_EC" : diagnosa + "|WARN_EC";
  }
}

// ================= 8. TASK CORE 1: SENSOR & KONTROL FAIL-SAFE =================
void TaskSensorAndControl(void *pvParameters) {
  uint32_t prevSensorTick = 0;
  bool sedangDosingAB = false, sedangDosingPH = false;
  uint32_t waktuMulaiAB = 0, waktuTerakhirAB = 0;
  uint32_t waktuMulaiPH = 0, waktuTerakhirPH = 0;

  for (;;) {
    uint32_t now = millis();

    bool isAuto, manA, manB, manPh, manCirc;
    float minPpm, minPh, maxPh;
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      isAuto  = sysData.modeOtomatis;
      manA    = sysData.pompaA;
      manB    = sysData.pompaB;
      manPh   = sysData.pompaPh;
      manCirc = sysData.pompaSirkulasi;
      minPpm  = sysData.minPpm;
      minPh   = sysData.minPh;
      maxPh   = sysData.maxPh;
      xSemaphoreGive(dataMutex);
    }

    // Pompa Sirkulasi (Active-LOW: RELAY_ON = LOW)
    digitalWrite(PIN_POMPA_SIRKULASI, manCirc ? RELAY_ON : RELAY_OFF);

    // Kendali Dosing
    if (isAuto) {
      if (sedangDosingAB && (now - waktuMulaiAB >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_A, RELAY_OFF);
        digitalWrite(PIN_POMPA_B, RELAY_OFF);
        sedangDosingAB = false;
        waktuTerakhirAB = now;
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaA = false; sysData.pompaB = false; sysData.triggerKirimSheets = true;
          xSemaphoreGive(dataMutex);
        }
      }

      if (sedangDosingPH && (now - waktuMulaiPH >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_PH, RELAY_OFF);
        sedangDosingPH = false;
        waktuTerakhirPH = now;
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaPh = false; sysData.triggerKirimSheets = true;
          xSemaphoreGive(dataMutex);
        }
      }
    } else {
      sedangDosingAB = false;
      sedangDosingPH = false;
      digitalWrite(PIN_POMPA_A, manA ? RELAY_ON : RELAY_OFF);
      digitalWrite(PIN_POMPA_B, manB ? RELAY_ON : RELAY_OFF);
      digitalWrite(PIN_POMPA_PH, manPh ? RELAY_ON : RELAY_OFF);
    }

    // Pembacaan Sensor Tiap 2.5 Detik
    if (now - prevSensorTick >= 2500 || prevSensorTick == 0) {
      prevSensorTick = now;
      float s, p, ecPpm;
      bool sensorSehat;
      String diag;
      ambilDanValidasiSensor(s, p, ecPpm, sensorSehat, diag);

      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        sysData.suhu = s; sysData.ph = p; sysData.ppm = ecPpm;
        sysData.sensorValid = sensorSehat; sysData.errSensor = diag;
        xSemaphoreGive(dataMutex);
      }

      if (isAuto) {
        if (!sensorSehat) {
          if (sedangDosingAB || sedangDosingPH) {
            digitalWrite(PIN_POMPA_A, RELAY_OFF);
            digitalWrite(PIN_POMPA_B, RELAY_OFF);
            digitalWrite(PIN_POMPA_PH, RELAY_OFF);
            sedangDosingAB = false; sedangDosingPH = false;
          }
        } else {
          bool jedaABSelesai = (now - waktuTerakhirAB >= JEDA_ADUK_DOSING) || (waktuTerakhirAB == 0);
          if (!sedangDosingAB && jedaABSelesai && (ecPpm < minPpm)) {
            digitalWrite(PIN_POMPA_A, RELAY_ON);
            digitalWrite(PIN_POMPA_B, RELAY_ON);
            sedangDosingAB = true;
            waktuMulaiAB = now;
            if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
              sysData.pompaA = true; sysData.pompaB = true; sysData.triggerKirimSheets = true;
              xSemaphoreGive(dataMutex);
            }
          }

          bool jedaPhSelesai = (now - waktuTerakhirPH >= JEDA_ADUK_DOSING) || (waktuTerakhirPH == 0);
          bool butuhPh = POMPA_C_ADALAH_PH_DOWN ? (p > maxPh) : (p < minPh);
          if (!sedangDosingPH && jedaPhSelesai && butuhPh) {
            digitalWrite(PIN_POMPA_PH, RELAY_ON);
            sedangDosingPH = true;
            waktuMulaiPH = now;
            if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
              sysData.pompaPh = true; sysData.triggerKirimSheets = true;
              xSemaphoreGive(dataMutex);
            }
          }
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ================= 9. TASK CORE 0: SINKRONISASI HTTP (GET & POST) =================
void TaskSheetsSync(void *pvParameters) {
  uint32_t prevSendTick = 0;
  uint32_t prevReadTick = 0;

  for (;;) {
    uint32_t now = millis();

    // 1. Polling Kontrol Sakelar Manual tiap 6 detik
    if (now - prevReadTick >= 6000 || prevReadTick == 0) {
      prevReadTick = now;
      bacaStatusKontrolDariSheets();
    }

    // 2. Kirim Telemetri tiap 30 detik atau saat Event Dosing Berubah
    bool perluKirim = false;
    float s, p, ppm;
    bool pA, pB, pPh, pCirc;
    String err;

    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (sysData.triggerKirimSheets || (now - prevSendTick >= 30000) || (prevSendTick == 0)) {
        perluKirim = true;
        sysData.triggerKirimSheets = false;
        s     = sysData.suhu;
        p     = sysData.ph;
        ppm   = sysData.ppm;
        pA    = sysData.pompaA;
        pB    = sysData.pompaB;
        pPh   = sysData.pompaPh;
        pCirc = sysData.pompaSirkulasi;
        err   = sysData.errSensor;
      }
      xSemaphoreGive(dataMutex);
    }

    if (perluKirim) {
      prevSendTick = now;
      kirimKeSheetsAman(s, p, ppm, pA, pB, pPh, pCirc, err);
    }

    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

// ================= 10. SETUP =================
void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Cegah restart akibat brownout Wi-Fi
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_TRANS_EC, OUTPUT);
  pinMode(PIN_POMPA_A, OUTPUT);
  pinMode(PIN_POMPA_B, OUTPUT);
  pinMode(PIN_POMPA_PH, OUTPUT);
  pinMode(PIN_POMPA_SIRKULASI, OUTPUT);

  digitalWrite(PIN_TRANS_EC, LOW);
  digitalWrite(PIN_POMPA_A, RELAY_OFF);
  digitalWrite(PIN_POMPA_B, RELAY_OFF);
  digitalWrite(PIN_POMPA_PH, RELAY_OFF);
  digitalWrite(PIN_POMPA_SIRKULASI, RELAY_OFF);

  analogReadResolution(12);
  sensors.begin();

  Serial.println(F("\n=========================================="));
  Serial.println(F("   PILIH MODE KONEKSI WI-FI ESP32"));
  Serial.println(F("=========================================="));
  Serial.println(F("1. Wi-Fi Rumah / Hotspot HP (WPA2-PSK)"));
  Serial.println(F("2. Wi-Fi Kampus IPB-ACCESS (WPA2-Enterprise)"));
  Serial.print(F("Pilih [1 atau 2]: "));

  String pilihan = readSerialInput();
  Serial.println(pilihan);

  if (pilihan == "1") {
    Serial.print(F("SSID: "));
    String ssid = readSerialInput();
    Serial.println(ssid);
    Serial.print(F("Password: "));
    String pass = readSerialInput();
    Serial.println(F("********"));

    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
  } else {
    Serial.print(F("SSID Enterprise (misal IPB-ACCESS): "));
    String ssid = readSerialInput();
    Serial.println(ssid);
    Serial.print(F("Username / NIM: "));
    String user = readSerialInput();
    Serial.println(user);
    Serial.print(F("Password Akun: "));
    String pass = readSerialInput();
    Serial.println(F("********"));

    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);
    esp_eap_client_set_identity((uint8_t *)user.c_str(), user.length());
    esp_eap_client_set_username((uint8_t *)user.c_str(), user.length());
    esp_eap_client_set_password((uint8_t *)pass.c_str(), pass.length());
    esp_wifi_sta_enterprise_enable();
    WiFi.begin(ssid.c_str());
  }

  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(F("."));
    if (++timeout > 60) {
      Serial.println(F("\n[KONEKSI GAGAL] Periksa kredensial / jangkauan sinyal."));
      while (true);
    }
  }

  // Set DNS Manual Google & Cloudflare untuk lookup cepat script.google.com
  IPAddress dns1(8, 8, 8, 8);
  IPAddress dns2(1, 1, 1, 1);
  WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), dns1, dns2);

  Serial.println(F("\nWi-Fi Terhubung!"));
  Serial.print(F("IP Address: "));
  Serial.println(WiFi.localIP());

  digitalWrite(PIN_POMPA_SIRKULASI, RELAY_ON);

  dataMutex = xSemaphoreCreateMutex();

  xTaskCreatePinnedToCore(TaskSensorAndControl, "SensorTask", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskSheetsSync, "SheetsTask", 8192, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelete(NULL);
}
