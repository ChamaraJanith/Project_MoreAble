#include <Arduino.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <DFRobotDFPlayerMini.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>         
#include <ESP_Mail_Client.h>

// ======================== Wi-Fi Configuration ========================
#define WIFI_SSID "Chamara"          
#define WIFI_PASSWORD "Chamara1846"   

// ======================== MoreAble API Configuration ==================
#define API_SERVER_HOST "http://192.168.56.1:8081" 
#define TARGET_PASSENGER_ID "PAS-2026-00013" // Device එකට අදාළ Passenger ID එක


#define SMTP_HOST "smtp.gmail.com"
#define SMTP_PORT 465 

#define SYSTEM_SENDER_NAME "MoreAble Emergency System"
#define SYSTEM_EMAIL "chamarasweed44@gmail.com"
#define SYSTEM_APP_PASSWORD "barf colo ajov qkbm" // Gmail App Password

String dynamicGuardianEmail = "chamarajabeyrathna@gmail.com";
String dynamicGuardianName = "Guardian";
bool isGuardianSynced = false;

// ======================== Hardware & Objects =========================
SMTPSession smtp;
void emailCallback(SMTP_Status report);
LiquidCrystal_I2C lcd(0x27, 16, 2);
HardwareSerial fpsSerial(2);
DFRobotDFPlayerMini myDFPlayer;

const int BUTTON_PIN = 4;
bool emergencyActive = false; 
bool lastButtonState = HIGH;   

// ======================== Fetch Guardian from Backend =================
void fetchGuardianDetails() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MoreAble] WiFi not connected to fetch guardian.");
    return;
  }

  HTTPClient http;
  String url = String(API_SERVER_HOST) + "/api/guardians?passengerId=" + String(TARGET_PASSENGER_ID);
  Serial.print("[MoreAble] Fetching Guardian from: ");
  Serial.println(url);

  http.begin(url);
  http.setTimeout(5000);
  int httpCode = http.GET();

  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    Serial.println("[MoreAble] API Response: " + payload);

    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, payload);

    if (!error && doc["success"] == true) {
      const char* email = doc["guardian"]["email"];
      const char* name = doc["guardian"]["fullName"];

      if (email && strlen(email) > 0) {
        dynamicGuardianEmail = String(email);
        if (name && strlen(name) > 0) dynamicGuardianName = String(name);

        isGuardianSynced = true;
        Serial.println("[MoreAble] Synced Guardian: " + dynamicGuardianName + " <" + dynamicGuardianEmail + ">");

        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("Guardian Synced!");
        lcd.setCursor(0, 1);
        lcd.print(dynamicGuardianName.substring(0, 16));
        delay(2000);
      }
    } else {
      Serial.println("[MoreAble] JSON parse error or success=false");
    }
  } else {
    Serial.printf("[MoreAble] HTTP GET failed, code: %d, using default guardian.\n", httpCode);
  }
  http.end();
}

// ======================== Send Emergency Email ========================
void sendEmergencyEmail() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[MoreAble] WiFi not connected. Cannot send email.");
    lcd.setCursor(0, 1);
    lcd.print("No WiFi Conn!   ");
    return;
  }

  lcd.setCursor(0, 1);
  lcd.print("Alerting Guard..");
  
  ESP_Mail_Session session;
  session.server.host_name = SMTP_HOST;
  session.server.port = SMTP_PORT;
  session.login.email = SYSTEM_EMAIL;
  session.login.password = SYSTEM_APP_PASSWORD;
  session.login.user_domain = "";

  SMTP_Message message;
  message.sender.name = SYSTEM_SENDER_NAME;
  message.sender.email = SYSTEM_EMAIL;
  
  message.subject = "🚨 [MoreAble ALERT] Emergency Triggered!";
  message.addRecipient(dynamicGuardianName.c_str(), dynamicGuardianEmail.c_str());

  String htmlMsg = "<div style='font-family: Arial, sans-serif; padding: 20px; border: 2px solid #D32F2F; border-radius: 8px;'>"
                   "<h2 style='color: #D32F2F;'>🚨 EMERGENCY SOS ALERT!</h2>"
                   "<p>Dear <b>" + dynamicGuardianName + "</b>,</p>"
                   "<p>An urgent emergency button has been pressed on the <b>MoreAble Transit Device</b>.</p>"
                   "<table style='width: 100%; border-collapse: collapse;'>"
                   "<tr><td><b>Passenger ID:</b></td><td>" + String(TARGET_PASSENGER_ID) + "</td></tr>"
                   "<tr><td><b>Recipient Guardian:</b></td><td>" + dynamicGuardianEmail + "</td></tr>"
                   "<tr><td><b>Status:</b></td><td style='color: red; font-weight: bold;'>CRITICAL - ACTIVE</td></tr>"
                   "</table>"
                   "<p style='margin-top: 15px;'>Please contact the passenger or emergency support immediately.</p>"
                   "<hr style='border: none; border-top: 1px solid #ccc;'>"
                   "<small style='color: #666;'>Automated message sent by MoreAble Safety & Accessibility Network.</small>"
                   "</div>";

  message.html.content = htmlMsg.c_str();
  message.html.charSet = "utf-8";
  message.priority = esp_mail_smtp_priority::esp_mail_smtp_priority_high;

  if (!smtp.connect(&session)) {
    Serial.println("[MoreAble] Error connecting to SMTP Server: " + smtp.errorReason());
    return;
  }

  if (!MailClient.sendMail(&smtp, &message)) {
    Serial.println("[MoreAble] Error sending Email: " + smtp.errorReason());
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  lcd.init();
  lcd.backlight();
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("MoreAble System ");
  lcd.setCursor(0, 1);
  lcd.print("Connecting Wi-Fi");

  WiFi.mode(WIFI_STA); 
  WiFi.disconnect();
  delay(100);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  
  int timeout = 0;
  while (WiFi.status() != WL_CONNECTED && timeout < 20) {
    delay(500);
    Serial.print(".");
    timeout++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

    // Wi-Fi සම්බන්ධ වූ පසු Backend එකෙන් Dynamic Guardian Email fetch කිරීම
    fetchGuardianDetails();

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("MoreAble Ready  ");
  } else {
    Serial.println("\nWiFi Failed! Ready in offline mode.");
    lcd.clear();
    lcd.print("WiFi Fail! Ready");
  }

  smtp.callback(emailCallback);
  fpsSerial.begin(9600, SERIAL_8N1, 16, 17);
  delay(2000);
  
  bool dfStarted = false;
  for (int i = 0; i < 5; i++) {
    if (myDFPlayer.begin(fpsSerial, false, false)) {
      dfStarted = true;
      break;
    }
    delay(500);
  }

  if (!dfStarted) {
    Serial.println("DFPlayer Error!");
  } else {
    myDFPlayer.volume(15);
  }
}

void loop() {
  int currentButtonState = digitalRead(BUTTON_PIN);

  if (lastButtonState == HIGH && currentButtonState == LOW) {
    delay(50); // Debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      if (!emergencyActive) {
        Serial.println(F("[MoreAble] Emergency Activated!"));
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("EMERGENCY ACTIVE");
        lcd.setCursor(0, 1);
        lcd.print("Alerting Guardian");

        myDFPlayer.playMp3Folder(2);
        emergencyActive = true;

        sendEmergencyEmail();
      } else {
        Serial.println(F("[MoreAble] Emergency Stopped!"));
        myDFPlayer.stop();
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("MoreAble Ready  ");
        lcd.setCursor(0, 1);
        lcd.print("Emergency Reset ");
        emergencyActive = false;
      }
    }
  }
  lastButtonState = currentButtonState;
}

void emailCallback(SMTP_Status report) {
  Serial.println(report.info());
  if (report.success()) {
    lcd.setCursor(0, 1);
    lcd.print("Guardian Alerted");
  } else {
    lcd.setCursor(0, 1);
    lcd.print("Alert Failed!   ");
  }
}
