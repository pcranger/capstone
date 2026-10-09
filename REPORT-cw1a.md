# CW-1A report: approaching car no longer silenced

Branch cw1a-approach-alerts. Commits: 4ba6ca2 (failing test), ddbf143 (fix), plus this report.

## Diff summary
- src/crossing/crossingEngine.ts:279 hazard filter also keeps a vehicle when `looming.some(h=>h.trackId===t.id)`.
- src/crossing/crossingEngine.ts:285 `uncertain:!estimate?.supported`, `approaching:!!urgent && !!estimate?.supported` (no longer needs state MOVING).
- src/crossing/crossingEngine.ts:292 scan-block also counts a looming vehicle (a looming car is not "clear").
- src/ui/vehicleVisibility.ts:7 STATIONARY track is visible when `motionSupported!==true` or the stationary switch is on. Default settings unchanged.
- src/ui/Overlays.tsx:51 green only for STATIONARY + supported; otherwise yellow '#FFD600'.
- src/ui/DeveloperTelemetry.tsx:44 motion line shows " (unsure)" when not supported.

## Proof (real VehicleMotion + real CrossingEngine, nothing mocked)
New test __tests__/approachingVehicle.test.ts (car growing from ~6% per 100 ms, fixed centre, textured background, frames 100 ms apart, engine in SEARCHING mode).
- Before fix: FAIL at frame 4: `"hazards": true` expected, received `false`.
- After fix: PASS. Per frame: `f0:hazards=1 f1:1 f2:1 f3:0 f4:1 f5:1 f6:1 f7:1 f8:1 f9:1`; spoken on frames 4-9: `["VEHICLE_CLOSE_AHEAD"]`.
- Note: the scene uses constant closing speed (size = 1/time-to-contact), not a fixed 6% per frame. Reason: with exact 6% per frame the hazard is kept on frames 4-9 but NO phrase is spoken in that window (ran: spoken `[]`), because the car was already announced "Vehicle detected" on frame 0 and the engine's 3 s repeat rule (crossingEngine.ts:~529-541) only lets a CRITICAL escalation through; a fixed-percentage growth keeps time-to-contact at ~1.7 s (WARNING), never CRITICAL. A real car at constant speed reaches CRITICAL, so the spoken cue appears. Possible follow-up for the owner: re-announce when a car first becomes `approaching` after an earlier "uncertain" announcement. Not done (out of the brief).
- vehicleVisibility test {motion:'STATIONARY', motionSupported:false} visible by default: passes (fail-before checked by reading: old code returned showStationaryVehicles=false).

## Results
- `npx jest --ci --runInBand`: Test Suites 31 passed / 31; Tests 273 passed / 273. (Parallel run: mapPanel and interfaceMode timed out under load; alone they pass 5/5 and 28/28.)
- `npx tsc --noEmit`: exit 0, no output.
- `npx expo lint`: exit 0, no output.

## Existing tests edited
- __tests__/vehicleVisibility.test.ts line 11: helper `track()` now sets `motionSupported:true`. Why: the old helper omitted the flag, which now means "unknown" and is shown by design; the original assertions are about supported tracks. Plus one new test added.
- No other existing test changed (binaryMotionAlerts, crossing, developerTelemetry unchanged and passing).
