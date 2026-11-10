# Gate and Danger Zone BLE beacon

This sketch runs on a separate ESP32-C3 per fixed beacon. Select Gate or Danger Zone through the role definition in the sketch. Gate defaults are public radio identity examples. Danger Zone identity/UUID fields are intentionally empty; fill them with a distinct matching backend registration before compilation.

The primary advertisement contains the 128-bit service UUID so passive wearable scans can discover it. The beacon needs no Wi-Fi password or backend token. Matching is by UUID; the backend cannot distinguish two physical boards broadcasting the same identity.

Recorded tooling uses ESP32 core 3.2.1 and NimBLE-Arduino 2.5.1. Full compilation and physical radio behavior of this copy remain unverified. See [hardware](../../docs/HARDWARE.md) and [architecture](../../docs/ARCHITECTURE.md). No upload was performed.
