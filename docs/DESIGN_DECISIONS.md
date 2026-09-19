# Design decisions

A running record of *why* the app looks and behaves as it does, written as each change was made and checked on a
Galaxy S22+. [docs/UI_DESIGN.md](UI_DESIGN.md) holds the visual system (tokens, type, palette); this file holds the
judgement calls.

The test for every one of them was to look at the screen twice: once as someone with usable sight who needs the
camera, and once as someone who never sees it and hears the app through TalkBack.

## 1. The camera is the product, not the background

**Problem.** The status card had grown to a 56sp billboard with 76dp buttons under it, over a 160dp video
thumbnail. Two thirds of the screen was chrome. A sighted helper aiming the phone at a signal could not see the
signal.

**Decision.** Full-bleed camera, everything else floating in the bottom third, and a hard rule: *nothing permanent
sits above the bottom third except the app name and the settings button*.

**Consequences, in order of how much they freed:**

| Change | Height returned |
|---|---|
| Phase word 56sp → 34sp, and only when there *is* a phase | ~90 dp |
| Idle status collapsed to one row (`● ASSIST OFF  NO SIGNAL  Details`) | ~70 dp |
| "Describe surroundings" full-width button → icon in the control row | ~70 dp |
| Warnings collapsed to a single row | ~60 dp |
| Model/fps line off by default | ~20 dp |
| Buttons 76/64 dp → 56/48 dp, single-line labels | ~40 dp |

**The rule that came out of it:** *size follows importance, and importance is not constant*. "NO SIGNAL" is not
news — it is the normal state of a phone in a pocket. "DON'T WALK" is news. They should not be the same size, which
is what a fixed layout forces them to be.

**What I did not do:** shrink the *phase* text for everyone. A low-vision traveler standing at a curb needs that
word big. It is 34sp by default and 52sp under Settings → Large status text. The compromise is a setting, not a
smaller number for everybody.

## 2. Anything that covers the camera must be switchable

Every panel that can cover the view is now a setting, and the defaults were chosen by asking *what would a new
user, who has not read anything, need on screen?*

| Panel | Default | Why |
|---|---|---|
| Warnings | **on** | They say the app cannot see — silence there is dangerous |
| Scene detail | **off** | Useful, but it is an answer to a question most users never ask |
| Model / frame rate | **off** | Developer telemetry; it was on because *I* wanted it |
| Camera preview | on | The sighted helper's only feedback |
| Detection boxes | on | Cheap to draw, and they show the app is alive |
| Describe button | on | One icon, and it is the whole reason a blind user might open the app indoors |

## 3. A warning you have read should go away

**Problem.** The warnings panel repeated the same three messages forever. "No headphones" is true all day; after the
second time it is furniture, and it was covering the street.

**Decision.** Tap a warning to dismiss it. Dismissed warnings stay gone until the app is reopened, and each has a
stable id, so dismissing "no headphones" does not silence "lens covered" — and if the lens *is* covered later, that
is a new event and it shows.

**Why not auto-hide after a few seconds?** Because a blind user reaches the screen through TalkBack at their own
pace. A message that removes itself on a timer is a message they may never reach.

## 4. Clock directions, not left/right

Adopted from BlindSquare, Lazarillo and orientation-and-mobility practice: "vehicle at 2 o'clock" carries what
"vehicle on the right" throws away — 11 and 1 o'clock are both nearly ahead, and the difference decides whether a
car crosses your path or passes behind you. Used in the scene panel and in every walking instruction.

## 5. Short labels, full announcements

The button says **Start**; TalkBack says **"Start assist"**. The button says **Cross**; TalkBack says **"Start
crossing"**. Shrinking a control to fit the screen must never shrink what a blind user is told about it, so the
visible label and the accessibility label are set separately wherever they differ.

## 6. Settings live in a file you can read

DataStore is the runtime source of truth, but it is a binary blob. `crosswise.conf.json` mirrors it in
`Android/data/com.crosswise.app/files/`, is written on first launch, and is merged back on every read.

Three things this buys, all of them tested on the device:

1. An **API key** can be dropped in by hand — no rebuild, no typing a 40-character key on a phone keyboard at a
   desk.
2. A **tester's exact configuration** can be copied to a second phone with one `adb push`.
3. The **active model** can be switched from the file (`"customModelPath": "asset:models/crosswise.tflite"`),
   which is how the trained detector was restored during testing without touching the UI.

## 7. The assistant describes; it never decides

The Gemini scan is a port of AN-S3's three-view left/front/right prompt, with two changes. The answer is capped at
40 words, because it is spoken over traffic noise to someone standing at a curb and a paragraph there is worse than
useless. And the prompt forbids the model from saying whether it is safe to cross or walk — the app's whole safety
stance is that it reports what it perceives and the traveler decides. A cloud model is the last thing that should
be allowed to break that rule.

It calls the REST endpoint with a plain API key rather than the Firebase SDK the source project uses: no Firebase
project, no `google-services.json`, no extra dependency, and the key lives in the conf file above.

## 8. Navigation is a second job, not a second layer

Walking guidance is its own tab, and the tab only exists when the feature is switched on — four tabs stay four for
everyone who does not want it.

The one rule where the two jobs meet: **a route step is spoken at NORMAL priority, a vehicle warning at HIGH**. A
turn instruction can wait a second; a car cannot. The guidance itself is ported from AN-S3's `GuidanceManager`
unchanged in its maths — 15 m corridor, 5 m arrival, advance only at 95% along a segment so a wobbly GPS fix cannot
walk the route forward for you — and changed in one respect: it speaks only when the instruction actually changes.

## 9. Three typefaces, because there are two audiences

Inter by default (what a mainstream 2026 app looks like), Tinos for anyone who wants Times New Roman, and Atkinson
Hyperlegible — drawn by the Braille Institute for low-vision readers — for anyone who needs it. Each option is
rendered *in its own face* in the settings list, so the choice is shown rather than described.

## 10. What is still wrong

Written down because it will not be obvious later:

* The segmentation model runs at **2.5 fps on CPU**. Fine for describing a footpath, far too slow for traffic. It
  is selectable, not default, and the model line tells you which one you are running.
* Warnings return on relaunch by design; there is no "never show this again".
* Walking navigation has had **no field test** — it compiles, the screens work, and the API calls are written
  against current Places and Routes endpoints, but nothing has been walked with it.
* The Gemini scan asks the user to turn the phone three times over about seven seconds. That is a long time to
  stand still at a kerb. It may want a one-shot mode.
