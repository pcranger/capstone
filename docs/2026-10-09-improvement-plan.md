# Navigation and vehicle-warning improvements

Scope: Android React Native project in `capstone_android`. The iOS directory is a separate copy and has not received this batch.

## Batch 1 — implemented

- Verified Google Routes requests `travelMode: WALK`; existing request-level regression test covers it.
- Vehicle warning eligibility now requires a current vehicle track with `MOVING` and supported motion evidence. Stationary and unsupported estimates no longer create audible/haptic vehicle hazards. Unsupported vehicles still block clear-scan completion; silence is not interpreted as a clear road.
- Restored the missing Android local Expo module source, including orientation, haptics, camera field of view and battery methods. The prior port had the TypeScript wrapper and module configuration but omitted the nested Android implementation. Without orientation, directional announcements fell back to generic warnings.
- Left-to-right motion maps to “Vehicle coming from the left”; right-to-left maps to “Vehicle coming from the right”. These are measured camera-relative directions, only spoken when orientation is fresh and the phone remains near the scan's reference heading. Missing/stale orientation or turning preserves a generic moving warning. This is not street-side localization and does not prove the vehicle will intersect the pedestrian's path.
- Existing separate moving/stationary box buttons remain in the Developer camera panel and Settings. Slashed icons mean hidden. Display filters do not disable warnings or motion analysis.

### Computation decision

Keep detecting vehicles before motion classification. YOLO uses a single frame to locate objects; temporal analysis then distinguishes motion from camera/background movement. Suppressing stationary boxes saves drawing, not the main inference. Removing stationary tracks would also make it harder to recognize a parked vehicle starting to move. No detector-class or model changes in this batch.

### Validation and limitations

- Added regressions for unsupported moving/stationary estimates and missing/stale/turning orientation; updated crossing-state scenarios to supply explicit confirmed-motion evidence.
- Android release built with `crosswise-native` compilation and its generated Expo module registration verified.
- Physical Samsung verification remains pending: no device connected through ADB during this batch. No real-road accuracy claim follows from mocked warning tests.
- Existing classifier deliberately withholds supported motion while the walking detector reports camera translation. Consequently moving-only warnings can be silent while the user walks or when image evidence is insufficient. Improving this needs recorded-video evaluation; do not silently treat unsupported classifications as reliable stationary cars.
- Field checks: hold phone upright and steady, verify heading updates in Developer telemetry, observe parked cars without alerts, verify passing vehicles in both directions, pan phone across parked cars, verify box buttons independently, and confirm haptics. Evaluate from a protected observation location.

## Batch 2 — pending: voice and route lifecycle

1. Add a route-specific confirmation for walking distance strictly greater than 1,000 metres: “The trip is over 1 kilometre. Do you want to proceed?” Accept yes/proceed and no/cancel while that confirmation is pending. Do not start until affirmative confirmation. Apply to voice and touch entry points, including replanning when appropriate. Clear consent when destination/route changes, on cancellation or app suspension. Tests: 999, 1000, 1001 metres; yes/no; unrelated commands; cancelled/stale requests; touch bypass; changed destination.
2. Replace the current one-time delayed progress speech with repeating “Finding route” / “Searching” at five-second intervals while the corresponding request remains pending. Never overlap speech or queue stale progress; stop on success, error, cancellation, replacement and backgrounding. Hazard speech retains priority. Test with controlled timers and slow/rejected/cancelled requests.
3. Review parser, spoken responses, in-app manual and Developer speech preview together. Distinguish pause, stop navigation, cancel search and stop listening. Document all supported commands and context-specific yes/no. Remove inactive generic vehicle prompt from preview or explicitly label it inactive. Do not announce successful completion before the action succeeds.

## Batch 3 — pending: direction arrow

- Asset confirmed at `/Users/hieu/Desktop/capstone/source/carArrow.glb` (about 1.6 KB).
- Inspect model orientation/scale and select an Expo/RN-compatible renderer before adding dependencies.
- Display a small arrow near the bottom of the camera in both interface modes, preserving camera view and map controls. Derive bearing from the next usable route segment and an absolute heading source; the restored game rotation vector is a relative heading and cannot alone align an arrow with the map.
- Hide or show an explicit unavailable state when no route, stale heading/location, paused navigation or arrival; never show a fabricated forward direction. Do not use it as an instruction to cross traffic.
- Test wraparound at north, route turns, phone rotation, rerouting, poor GPS, app resume, screen-reader labeling, rendering cost and inference frame rate on Samsung. Keep verbal route guidance available for users who cannot see the arrow.

## Follow-up model work

Evaluate false movement on stationary vehicles, night glare and direction accuracy against labeled road recordings, including camera translation. Report false alerts and missed moving vehicles separately. This batch changes warning policy and restores native integration; it does not retrain or establish improved model accuracy.
