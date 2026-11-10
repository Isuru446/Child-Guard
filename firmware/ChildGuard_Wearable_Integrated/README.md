# Integrated ESP32-C3 wearable

The wearable combines MPU6050 movement sampling, UART GPS, Gate/Danger Zone BLE filtering, prototype bus observations, a physical tamper loop and authenticated Wi-Fi telemetry. Copy `secrets.example.h` to ignored `secrets.h` and configure credentials privately before compilation.

Use the pin allocation and USB CDC requirements in [HARDWARE.md](../../docs/HARDWARE.md). Tamper uses GPIO20/21 and requires native USB diagnostics. The recorded partition setting is `min_spiffs`; verify the actual linked size before any upload.

Telemetry retries retain event identity. GPS latest-only handling and bounded queues reduce stale evidence but cannot guarantee delivery. The current wearable HTTP transport needs a reviewed secure replacement before deployment. See [architecture](../../docs/ARCHITECTURE.md), [security](../../docs/SECURITY_REVIEW.md) and [validation](../../docs/VALIDATION.md). No physical device was accessed.
