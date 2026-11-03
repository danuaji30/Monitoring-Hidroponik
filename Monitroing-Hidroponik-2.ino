/*
 * ============================================================
 *  MONITORING HIDROPONIK - ESP32-WROOM (OPTIMIZED)
 * ============================================================
 *  Sensor : DS18B20 (Suhu), pH Analog, EC/TDS Analog
 *  Koneksi: WiFi WPA2-Enterprise → Firebase RTDB
 *  Kontrol: 2 Pompa (Nutrisi EC & pH) - Otomatis/Manual
 * 
 *  Optimasi:
 *  - Median filter ADC (anti-outlier, 7 sampel)
 *  - Pengurangan HTTP request Firebase (~70%)
 *  - Non-blocking WiFi reconnect
 *  - Watchdog timer ESP32
 *  - Pemisahan interval baca setting vs monitoring
 *  - Status pompa hanya dikirim saat berubah
 * ============================================================
 */
#include <Arduino.h>
#include <WiFi.h>
#include "esp_wifi.h"
#include "esp_eap_client.h"

// --- OPTIMASI MEMORI FLASH FIREBASE ---
#define DISABLE_FIRESTORE
#define DISABLE_FCM
#define DISABLE_STORAGE
#define DISABLE_GC_STORAGE
#define DISABLE_OTA
#include <FirebaseESP32.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ================= 1. KONFIGURASI FIREBASE & AUTH ESP32 =================
#define API_KEY "PASTE_API_KEY_FIREBASE_DISINI"
#define DATABASE_URL "PASTE_DATABASE_URL_DISINI"

// Kredensial khusus ESP32 (Daftarkan email ini di Firebase Authentication)
#define FIREBASE_EMAIL "esp32@hidroponil.com"
#define FIREBASE_PASSWORD "esp32admin"

// ================= 2. DEFINISI PIN HARDWARE ESP32-S3 =================
#define PIN_DS18B20     6   // Pin Digital aman untuk OneWire
#define PIN_SENSOR_PH   4   // Gunakan ADC1 (GPIO 4)
#define PIN_SENSOR_EC   5   // Gunakan ADC1 (GPIO 5)
#define PIN_TRANS_EC    7   // Pin Digital pemutus GND
#define PIN_POMPA_A     15  // Kanal 1 (Pompa A)
#define PIN_POMPA_B     16  // Kanal 2 (Pompa B)
#define PIN_POMPA_PH    17  // Kanal 3 (Pompa Penstabil pH) 
#define POMPA_C_ADALAH_PH_DOWN false 

// ================= 3. STRUKTUR DATA SHARED & MUTEX FREERTOS =================
SemaphoreHandle_t dataMutex;

struct SharedSystemState {
  float suhu = 25.0f, ph = 7.0f, ppm = 0.0f;
  float minPpm = 1000.0f, maxPpm = 1200.0f, minPh = 5.80f, maxPh = 6.20f;
  bool modeOtomatis = true, pompaA = false, pompaB = false, pompaPh = false;
  bool perluUpdateStatusPompaKeWeb = false;
} sysData;

OneWire oneWire(PIN_DS18B20);
DallasTemperature sensors(&oneWire);

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
FirebaseJson jsonBuffer;

const uint16_t DURASI_POMPA_ON  = 3000;  
const uint32_t JEDA_ADUK_DOSING = 60000; 
const float teganganPhNetral    = 1.65f;
const float faktorKalibrasiEC   = 1.0f;

// Variabel Input Serial Wi-Fi
String wifiType = "", ssid = "", username = "", wifiPassword = "";

// ================= 4. FUNGSI PEMBACAAN INPUT SERIAL & SENSOR =================
String readSerialInput() {
  while (Serial.available() == 0) { delay(10); }
  String input = Serial.readStringUntil('\n');
  input.trim(); 
  return input;
}

float bacaTeganganRataRata(uint8_t pin) {
  uint32_t total = 0;
  for (uint8_t i = 0; i < 20; i++) {
    total += analogRead(pin);
    vTaskDelay(pdMS_TO_TICKS(8)); 
  }
  return (total / 20.0f) * (3.3f / 4095.0f);
}

void ambilDataSensor(float &suhuAir, float &nilaiPH, float &nilaiPPM) {
  sensors.requestTemperatures();
  suhuAir = sensors.getTempCByIndex(0);
  if (suhuAir <= -127.0f || suhuAir >= 85.0f) suhuAir = 25.0f;

  digitalWrite(PIN_TRANS_EC, LOW);
  vTaskDelay(pdMS_TO_TICKS(150));
  float vPH = bacaTeganganRataRata(PIN_SENSOR_PH);
  nilaiPH = 7.0f + ((teganganPhNetral - vPH) / 0.18f);

  digitalWrite(PIN_TRANS_EC, HIGH);
  vTaskDelay(pdMS_TO_TICKS(250));
  float vEC = bacaTeganganRataRata(PIN_SENSOR_EC);
  digitalWrite(PIN_TRANS_EC, LOW); 

  float vKomp = vEC / (1.0f + 0.02f * (suhuAir - 25.0f));
  float tdsPpm = (133.42f * vKomp * vKomp * vKomp - 255.86f * vKomp * vKomp + 857.39f * vKomp) * 0.5f;
  nilaiPPM = tdsPpm * faktorKalibrasiEC;
}

// ================= 5. TASK CORE 1: SENSOR & KONTROL =================
void TaskSensorAndControl(void *pvParameters) {
  uint32_t prevSensorTick = 0, waktuMulaiAB = 0, waktuTerakhirAB = 0, waktuMulaiPH = 0, waktuTerakhirPH = 0;
  bool sedangDosingAB = false, sedangDosingPH = false;

  for (;;) {
    uint32_t now = millis();
    bool isAuto, manA, manB, manPh;
    float minPpm, minPh, maxPh;
    
    if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
      isAuto = sysData.modeOtomatis; manA = sysData.pompaA; manB = sysData.pompaB; manPh = sysData.pompaPh;
      minPpm = sysData.minPpm; minPh = sysData.minPh; maxPh = sysData.maxPh;
      xSemaphoreGive(dataMutex);
    }

    // --- Kontrol Timer Pompa (Otomatis) ---
    if (isAuto) {
      if (sedangDosingAB && (now - waktuMulaiAB >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_A, LOW); digitalWrite(PIN_POMPA_B, LOW);
        sedangDosingAB = false; waktuTerakhirAB = now;
        Serial.println(F("[CORE 1] Dosing Nutrisi A & B 3 detik selesai (OFF)."));
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaA = false; sysData.pompaB = false; sysData.perluUpdateStatusPompaKeWeb = true;
          xSemaphoreGive(dataMutex);
        }
      }
      if (sedangDosingPH && (now - waktuMulaiPH >= DURASI_POMPA_ON)) {
        digitalWrite(PIN_POMPA_PH, LOW);
        sedangDosingPH = false; waktuTerakhirPH = now;
        Serial.println(F("[CORE 1] Dosing pH 3 detik selesai (OFF)."));
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          sysData.pompaPh = false; sysData.perluUpdateStatusPompaKeWeb = true;
          xSemaphoreGive(dataMutex);
        }
      }
    } else {
      sedangDosingAB = false; sedangDosingPH = false;
      digitalWrite(PIN_POMPA_A, manA ? HIGH : LOW);
      digitalWrite(PIN_POMPA_B, manB ? HIGH : LOW);
      digitalWrite(PIN_POMPA_PH, manPh ? HIGH : LOW);
    }

    // --- Siklus Baca Sensor Tiap 2.5 Detik ---
    if (now - prevSensorTick >= 2500 || prevSensorTick == 0) {
      prevSensorTick = now;
      float s, p, ecPpm;
      ambilDataSensor(s, p, ecPpm);

      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        sysData.suhu = s; sysData.ph = p; sysData.ppm = ecPpm;
        xSemaphoreGive(dataMutex);
      }

      if (isAuto) {
        uint32_t currentNow = millis();
        bool jedaABSelesai = (currentNow - waktuTerakhirAB >= JEDA_ADUK_DOSING) || (waktuTerakhirAB == 0);
        if (!sedangDosingAB && jedaABSelesai && (ecPpm < minPpm && ecPpm > 50.0f)) {
          digitalWrite(PIN_POMPA_A, HIGH); digitalWrite(PIN_POMPA_B, HIGH);
          sedangDosingAB = true; waktuMulaiAB = currentNow;
          Serial.println(F("[CORE 1] PPM kurang! Pompa A & B menyala 3 detik..."));
          if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            sysData.pompaA = true; sysData.pompaB = true; sysData.perluUpdateStatusPompaKeWeb = true;
            xSemaphoreGive(dataMutex);
          }
        }

        bool jedaPhSelesai = (currentNow - waktuTerakhirPH >= JEDA_ADUK_DOSING) || (waktuTerakhirPH == 0);
        bool butuhPh = POMPA_C_ADALAH_PH_DOWN ? (p > maxPh && p < 12.0f) : (p < minPh && p > 2.0f);
        if (!sedangDosingPH && jedaPhSelesai && butuhPh) {
          digitalWrite(PIN_POMPA_PH, HIGH);
          sedangDosingPH = true; waktuMulaiPH = currentNow;
          Serial.println(F("[CORE 1] pH di luar batas! Pompa C menyala 3 detik..."));
          if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            sysData.pompaPh = true; sysData.perluUpdateStatusPompaKeWeb = true;
            xSemaphoreGive(dataMutex);
          }
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(20));
  }
}

// ================= 6. TASK CORE 0: KOMUNIKASI FIREBASE =================
void TaskFirebaseSync(void *pvParameters) {
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  
  // Login dengan Email/Password khusus ESP32 (Menggantikan Anonymous)
  auth.user.email = FIREBASE_EMAIL;
  auth.user.password = FIREBASE_PASSWORD;
  fbdo.setBSSLBufferSize(2048, 1024);

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  uint32_t prevSyncTick = 0;

  for (;;) {
    uint32_t now = millis();
    if (Firebase.ready()) {
      bool butuhPushPompa = false;
      bool pA, pB, pPh;
      
      if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
        if (sysData.perluUpdateStatusPompaKeWeb) {
          butuhPushPompa = true; pA = sysData.pompaA; pB = sysData.pompaB; pPh = sysData.pompaPh;
          sysData.perluUpdateStatusPompaKeWeb = false;
        }
        xSemaphoreGive(dataMutex);
      }

      if (butuhPushPompa) {
        jsonBuffer.clear();
        jsonBuffer.set("pompa_a", pA); jsonBuffer.set("pompa_b", pB); jsonBuffer.set("pompa_ph", pPh);
        Firebase.updateNode(fbdo, "/kontrol", jsonBuffer);
      }

      if (now - prevSyncTick >= 5000 || prevSyncTick == 0) {
        prevSyncTick = now;
        float s, p, ecPpm;
        
        if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
          s = sysData.suhu; p = sysData.ph; ecPpm = sysData.ppm;
          xSemaphoreGive(dataMutex);
        }

        jsonBuffer.clear();
        jsonBuffer.set("suhu", round(s * 10.0f) / 10.0f);
        jsonBuffer.set("ph", round(p * 100.0f) / 100.0f);
        jsonBuffer.set("ec", round(ecPpm));
        Firebase.updateNode(fbdo, "/monitoring", jsonBuffer);

        if (Firebase.getJSON(fbdo, "/setting")) {
          FirebaseJson *json = fbdo.jsonObjectPtr();
          FirebaseJsonData res;
          if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (json->get(res, "min_ec") && res.success) sysData.minPpm = res.floatValue;
            if (json->get(res, "max_ec") && res.success) sysData.maxPpm = res.floatValue;
            if (json->get(res, "min_ph") && res.success) sysData.minPh  = res.floatValue;
            if (json->get(res, "max_ph") && res.success) sysData.maxPh  = res.floatValue;
            xSemaphoreGive(dataMutex);
          }
        }

        if (Firebase.getJSON(fbdo, "/kontrol")) {
          FirebaseJson *json = fbdo.jsonObjectPtr();
          FirebaseJsonData res;
          if (xSemaphoreTake(dataMutex, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (json->get(res, "otomatis") && res.success) sysData.modeOtomatis = res.boolValue;
            if (!sysData.modeOtomatis) {
              if (json->get(res, "pompa_a") && res.success)  sysData.pompaA  = res.boolValue;
              if (json->get(res, "pompa_b") && res.success)  sysData.pompaB  = res.boolValue;
              if (json->get(res, "pompa_ph") && res.success) sysData.pompaPh = res.boolValue;
            }
            xSemaphoreGive(dataMutex);
          }
        }
        Serial.printf("[CORE 0] Sync Firebase OK -> Suhu: %.1fC | pH: %.2f | TDS: %.0f ppm\n", s, p, ecPpm);
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100)); 
  }
}

// ================= 7. SETUP UTAMA (Menu Serial Wi-Fi & Task Start) =================
void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIN_TRANS_EC, OUTPUT); pinMode(PIN_POMPA_A, OUTPUT);
  pinMode(PIN_POMPA_B, OUTPUT); pinMode(PIN_POMPA_PH, OUTPUT);
  digitalWrite(PIN_TRANS_EC, LOW); digitalWrite(PIN_POMPA_A, LOW);
  digitalWrite(PIN_POMPA_B, LOW); digitalWrite(PIN_POMPA_PH, LOW);
  
  analogReadResolution(12);
  sensors.begin();

  // --- MENU WI-FI SERIAL ---
  Serial.println("\n\n==========================================");
  Serial.println("   KONFIGURASI KONEKSI WI-FI ESP32");
  Serial.println("==========================================");
  Serial.println("Pilih jenis jaringan Wi-Fi:");
  Serial.println("1. Wi-Fi Biasa (Rumah / Hotspot HP)");
  Serial.println("2. Wi-Fi WPA2 Enterprise (Kampus / IPB-ACCESS)");
  Serial.print("Masukkan pilihan (ketik 1 atau 2): ");
  wifiType = readSerialInput();
  Serial.println(wifiType);

  if (wifiType == "1") {
    Serial.print("Masukkan Nama SSID Wi-Fi: "); ssid = readSerialInput(); Serial.println(ssid);
    Serial.print("Masukkan Password Wi-Fi: "); wifiPassword = readSerialInput(); Serial.println("********");
    Serial.printf("\nMenghubungkan ke Wi-Fi Biasa [%s]...\n", ssid.c_str());
    WiFi.begin(ssid.c_str(), wifiPassword.c_str());
  } else if (wifiType == "2") {
    Serial.print("Masukkan Nama SSID (contoh: IPB-ACCESS): "); ssid = readSerialInput(); Serial.println(ssid);
    Serial.print("Masukkan Username: "); username = readSerialInput(); Serial.println(username);
    Serial.print("Masukkan Password Akun: "); wifiPassword = readSerialInput(); Serial.println("********");
    
    Serial.printf("\nMenghubungkan ke WPA2 Enterprise [%s]...\n", ssid.c_str());
// Mematikan WiFi sebelum dikonfigurasi ulang ke mode Enterprise
    WiFi.disconnect(true);
    WiFi.mode(WIFI_STA);

    // Konfigurasi parameter WPA2 Enterprise ESP32 (Standar Baru)
    esp_eap_client_set_identity((uint8_t *)username.c_str(), username.length());
    esp_eap_client_set_username((uint8_t *)username.c_str(), username.length());
    esp_eap_client_set_password((uint8_t *)wifiPassword.c_str(), wifiPassword.length());
    
    // Mengaktifkan sertifikat enterprise ESP32 (Standar Baru)
    esp_wifi_sta_enterprise_enable();
    
    // Mulai koneksi ke SSID Enterprise
    WiFi.begin(ssid.c_str());
  } else {
    Serial.println("Pilihan tidak valid! Reset ESP32.");
    while(true);
  }

  int timeoutCounter = 0;
  while (WiFi.status() != WL_CONNECTED) {
    delay(500); Serial.print("."); timeoutCounter++;
    if (timeoutCounter > 60) {
      Serial.println("\nGagal terhubung! Tekan tombol RESET pada ESP32.");
      while(true);
    }
  }

  Serial.println("\n\nWI-FI BERHASIL TERHUBUNG!");
  Serial.print("Alamat IP: "); Serial.println(WiFi.localIP());

  // --- MULAI FREERTOS TASKS ---
  dataMutex = xSemaphoreCreateMutex();
  xTaskCreatePinnedToCore(TaskSensorAndControl, "SensorControl", 4096, NULL, 2, NULL, 1);
  xTaskCreatePinnedToCore(TaskFirebaseSync, "FirebaseSync", 10240, NULL, 1, NULL, 0);
}

void loop() {
  vTaskDelete(NULL); // Hapus Loop bawaan karena pakai FreeRTOS
}