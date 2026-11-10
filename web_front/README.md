# ChildGuard Web Admin

React/Vite Web Admin provides role-authorized management and monitoring for the ChildGuard V2 backend. Source includes attendance, children, wearable assignments, beacons, RFID readers, alerts, activity, pickup and prototype transport views.

Use Node.js >=22.12.0, then `npm ci --ignore-scripts`. Copy `.env.example` to a local ignored `.env` and set the public API endpoint. Browser configuration must contain no credentials. Run `npm run dev -- --port 5174 --strictPort` after backend readiness has been established. The development proxy supports the retained localhost admin cookie workflow.

Run `npm test`, `npm run lint` and `npm run build`. Build output is ignored. See [setup](../docs/SETUP.md), [validation](../docs/VALIDATION.md) and [security](../docs/SECURITY_REVIEW.md). Demonstration records are synthetic; production reads must come from authorized API responses.
