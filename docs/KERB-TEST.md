# Kerb test script

For a sighted helper walking with Minh at a real kerb. Some behaviour is planned and being built; where a spoken line differs, write down what the phone really said.

## Safety
- The helper always decides whether to cross. Never rely on the app.
- Use a quiet, straight road with a footpath. Stand well back from the kerb for each check.
- Do not cross during scenarios 1 to 7, 9 and 10. Crossing is only tested in scenario 8, and only when the helper judges it clear.

## Rule for safety-critical scenarios
Minh's rule: anything safety-critical is repeated 3 times in a row, and all 3 must pass. Scenarios 1, 2, 3, 4, 5, 7 and 8 are safety-critical. One fail fails the scenario; fix, then start the 3 again.

## Before
- [ ] Phone charged above 80%. Volume up. One earbud or bone-conduction headphones.
- [ ] Settings: hold time 5 s, road width set to the road (lanes: ___), steering hints OFF.
- [ ] Developer mode ON, so the timing readout shows. Build: ______
- [ ] Camera, microphone and location allowed.
- [ ] App force-closed, ready for scenario 10.

## Scenarios

### 1. No traffic
Steps: stand at the kerb, press Start. Turn right, hold, turn left, hold, face the road.
Expect: a tick each second, "Right side checked", then "No vehicles seen on either side. Cross if you judge it clear."
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 2. A car from the right during the right hold
Steps: start the check and time the hold so a car passes from the right.
Expect: "Vehicle on your right, moving. Wait."
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 3. A car from the left
Steps: start the check so a car comes from the left during the left hold.
Expect: "Vehicle on your left, moving. Wait."
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 4. A parked car only
Steps: stand near a parked car with no moving traffic. Run the check.
Expect: "Vehicle seen, not moving. Check again." It must not say "No vehicles seen".
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 5. Wrong way first
Steps: press Start, then turn LEFT first.
Expect: a prompt to turn the other way. No result until both sides are held.
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 6. Not turning for 30 s
Steps: press Start and stand still for 30 s.
Expect: repeated prompts, then the check gives up and says to check again. Exact lines heard: ______
[ ] Pass [ ] Fail

### 7. Covering the camera
Steps: start the check and cover the lens with a finger during a hold.
Expect: "Camera could not see clearly. Check again." That side is never reported as clear.
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 8. Power-button press mid-crossing
Steps: get a clear result, press Cross, and at the halfway call press the power button. The helper walks beside Minh and is ready to stop him.
Expect: the app says nothing misleading, and after unlocking it does not claim a finished crossing. What happened: ______
Run 1 [ ] Pass [ ] Fail   Run 2 [ ] Pass [ ] Fail   Run 3 [ ] Pass [ ] Fail

### 9. Voice "check again"
Steps: get a result, then say "check again". Also try "repeat" and "stop".
Expect: the check restarts; "repeat" repeats the last line; "stop" ends the check.
[ ] Pass [ ] Fail

### 10. First start versus second start
Steps: force-close the app. Open it, press Start, and time from Start to the "ready" tone. Then close and reopen the app and time again.
Expect: first start about 10 s ("Getting ready", then a "ready" tone); second start about 1 s.
First: ____ s   Second: ____ s   [ ] Pass [ ] Fail

## Developer-mode readings (ms)
| Run | Scenario | Detection (ms) | Frame (ms) | Frames used, right | Frames used, left | Notes |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |
| 6 | | | | | | |

## Sign-off
Helper: ______   Date: ______   Result: [ ] All pass   [ ] Failed scenarios: ______
