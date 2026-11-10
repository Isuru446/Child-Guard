# Bus BLE beacon prototype

A separate ESP32-C3 advertises the bus UUID defined in this sketch; it must differ from every Gate and Danger Zone UUID. No external sensor wiring is required. Do not register this identity as a fixed safety beacon. The backend opt-in settings are in `backend/bus-transport.env.example`.

Optional UUID overrides use ignored `bus.private.h` on this board and the wearable, with a matching backend value. BLE identity is public and spoofable. Presence inference does not prove boarding, passenger identity or custody transfer.

Recorded tooling uses ESP32 core 3.2.1 and NimBLE-Arduino 2.5.1. See [hardware](../../docs/HARDWARE.md), [architecture](../../docs/ARCHITECTURE.md) and [validation](../../docs/VALIDATION.md). Full linking and hardware acceptance remain pending. No upload was performed.
