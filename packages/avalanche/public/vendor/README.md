# Vendored

`chart.umd.js` — Chart.js v4.5.0, MIT, from
https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.js

Dropped in pristine, exactly as published, so it can be checked against
upstream:

    shasum -a 256 chart.umd.js
    b7929ad4d5323b8244f85d79bba0b3d1495e66f79a2f0023be7f4de5ba4fbac8

Leave it unformatted: reformatting the file would leave it unverifiable against the source it came
from.

Vendored rather than loaded from a CDN so the app has no third-party runtime
dependency and works with no network beyond its own origin.
