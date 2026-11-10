# RFID attendance reader

This separate ESP32-C3/RC522 board uses SPI: SS GPIO7, SCK GPIO4, MOSI GPIO6, MISO GPIO5 and RST GPIO3. Use 3.3 V and common ground. These pins do not belong to the wearable wiring.

Copy `secrets.example.h` to ignored `secrets.h` privately. Provision a reader credential separate from wearable credentials. HTTPS uses a configured CA and host allowlist; trusted-LAN HTTP is disabled in the example. Never use insecure certificate bypass. The backend requires the reviewed RFID storage and a private stable UID HMAC key.

`PresentationGuard.h` suppresses repeated presentation while a card remains at the reader. Supported card UID possession is not strong personal authentication. MFRC522 1.4.12 is referenced by the original hardware review. The `0x82` variation has no matching library digital self-test reference; unsupported self-test must not be described as passed.

See [hardware](../../docs/HARDWARE.md), [database limitations](../../docs/DATABASE.md) and [testing](../../docs/TESTING.md). Full linking and hardware acceptance remain pending. No reader was installed or flashed.
