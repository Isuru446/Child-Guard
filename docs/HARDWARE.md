# Hardware and firmware

All four sketches are retained. No firmware was flashed and no physical device was accessed during repository preparation.

| Board | Sketch | Main components |
| --- | --- | --- |
| Wearable | `firmware/ChildGuard_Wearable_Integrated` | ESP32-C3, MPU6050, UART GPS, continuity loop |
| Gate / Danger Zone | `firmware/ChildGuard_Beacon` | Separate ESP32-C3 per beacon; compile-time role selection |
| Bus beacon | `firmware/ChildGuard_Bus_Beacon` | Separate ESP32-C3 with USB power; no external sensors |
| RFID reader | `firmware/ChildGuard_RFID_Reader` | Separate ESP32-C3 and RC522 SPI module |

## Wearable connections

| Function | Source-defined wiring |
| --- | --- |
| MPU6050 I2C | SDA GPIO0, SCL GPIO1, address `0x68` |
| GPS UART1 | ESP RX GPIO7, ESP TX GPIO6, 9600 baud; cross TX/RX with module |
| Tamper input | GPIO20, `INPUT_PULLUP` |
| Tamper sink | GPIO21, `OUTPUT_OPEN_DRAIN`, LOW |
| Native USB | GPIO18/19 reserved |

The documented loop connects GPIO20 through the continuity wire and a 1 kΩ series resistor to GPIO21. Closed reads LOW and open reads HIGH. Use only compatible 3.3 V logic and insulated connections; verify power requirements against each module before wiring. Wire with power removed and test on an adult bench. Continuity does not prove correct wearing or safety.

The tamper module requires ESP32-C3 and USB CDC On Boot enabled because GPIO20/21 are also UART0 pins. Do not use UART0 logging on them. GPS uses UART1. The recorded wearable board setting is ESP32C3 Dev Module, 4 MB flash, Minimal SPIFFS (`min_spiffs`) partition scheme. Verify the linked image fits before any separately authorized upload; no current binary size is claimed.

Required sketch libraries include NimBLE-Arduino, TinyGPSPlus and ArduinoJson, plus the ESP32 core's WiFi, HTTPClient, Preferences and Wire APIs. The recorded BLE API baseline is NimBLE-Arduino 2.5.1 / ESP32 core 3.2.1. TinyGPSPlus and ArduinoJson versions are not pinned in the available source and remain a reproducibility gap.

## Fixed BLE beacons

The Gate default identity and UUID are public radio configuration, not credentials. For Danger Zone builds select the danger-zone role in the sketch and supply a distinct registered hardware ID and lowercase UUID; blanks intentionally refuse advertising. Each physical board needs a unique identity matching backend registration in the correct center.

Advertisements place the 128-bit service UUID in the primary advertisement because wearable scans are passive. They are nonconnectable, use no scan response and restart advertising when necessary. Matching uses service UUID rather than advertised name or MAC address. BLE identifiers can be copied by another transmitter; they do not authenticate location.

The bus beacon uses its separate bus UUID and must not be registered as a Gate or Danger Zone. Optional `bus.private.h` overrides belong in ignored private files on the beacon and wearable, with matching backend configuration. See `backend/bus-transport.env.example`.

## RFID connections

The source assigns RC522 SS/SDA GPIO7, SCK GPIO4, MOSI GPIO6, MISO GPIO5 and RST GPIO3. Supply 3.3 V and common ground. These are a separate reader board's pins, not additional wearable connections. Firmware uses MFRC522; the recorded report references version 1.4.12. The `0x82` reader variation lacks a matching library digital self-test reference, so the firmware reports that limitation rather than claiming the self-test passed.

## Configuration and acceptance

Create ignored `secrets.h` from each wearable/reader example locally. Do not place real tokens or Wi-Fi credentials in source. Fixed BLE beacons need no backend credential. Configure each board's identity deliberately before compilation. Full Arduino linking, BLE timing under radio load, GPS reception, sensor calibration, tamper persistence and RFID hardware acceptance remain pending. Repository preparation does not authorize an upload.
