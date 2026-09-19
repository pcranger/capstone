# CrossWise UI design

The visual system for the Android app. Written before the redesign so every screen can be checked against it.

## Who is looking at the screen

Not "a user". Three of them, in this order:

1. **A low-vision traveler** standing at a curb, outdoors, often in sunlight, phone at chest height on a lanyard, maybe
   one hand on a cane. They have *some* usable vision — that is the whole reason pixels matter here. They need one
   answer, huge: *what is the signal doing right now?*
2. **A blind traveler** using TalkBack. They never see the layout; they hear it. Visual changes must not disturb the
   reading order, the headings, or the merged announcements.
3. **A sighted teammate or examiner** checking the app against reality, who needs the detection overlay and the
   fps/backend readout.

Everything below follows from that ranking. This is not a dashboard; it is a **status sign** with controls under it.

## Principles

1. **State first.** The phase card is the hero of the screen — sized so it is readable at arm's length in daylight.
   The camera preview is a viewfinder for the sighted helper, not wallpaper: it is inset, bounded and quiet.
2. **Color carries meaning, never decoration.** Green, amber, red, blue and grey mean walk, caution, don't walk,
   crossing and unknown. No other element may use those hues. Chrome is neutral slate.
3. **One type scale, no local sizes.** Every text takes a named style. Nothing hardcodes `fontSize`.
4. **Everything scales.** Sizes in `sp`, containers grow with their content, nothing clips at 200% font scale.
5. **Big, separated targets.** 56dp minimum (Android's floor is 48dp; this app is used standing, moving, one-handed),
   12dp between adjacent controls.
6. **Contrast above the bar.** ≥ 7:1 for the phase card and body text, ≥ 4.5:1 everywhere else. Checked, not guessed.

## Type

**Atkinson Hyperlegible** (Braille Institute, OFL 1.1) for the whole app. It was drawn for low-vision readers: the
letterforms that blur into each other in other faces — `I l 1`, `O 0`, `a e s` — are given distinct shapes and
asymmetric terminals. Using it here is a functional decision, not a stylistic one. Two weights only (400/700), so the
rhythm stays uniform; the system falls back to the platform sans if the font is unavailable.

| Slot | Size / weight | Used for |
|---|---|---|
| `displayLarge` | 56sp / 700, -1% tracking | The phase word: WALK, DON'T WALK |
| `headlineMedium` | 28sp / 700 | Screen titles (Settings) |
| `titleLarge` | 22sp / 700 | Card headings, button labels |
| `titleMedium` | 19sp / 700 | Setting row labels |
| `bodyLarge` | 18sp / 400, 26sp line | Detail lines, secondary readouts |
| `bodyMedium` | 16sp / 400, 23sp line | Spoken caption, help text |
| `labelLarge` | 14sp / 700, +8% tracking, uppercase | Eyebrows ("WAITING"), section headers |
| `labelMedium` | 13sp / 400 | Debug meta: model, fps, backend |

The jump from 56sp to 22sp is deliberate: at a glance there is exactly one thing to read.

## Color

Dark only. Not a style choice: it is the readable option at night, it costs less battery on this OLED, and it keeps the
screen from being a lamp in the user's face at a dark crossing.

| Token | Hex | Contrast vs its text | Meaning |
|---|---|---|---|
| `Background` | `#0B0F12` | — | App ground, slightly cool so cards read as lifted |
| `Surface` | `#161C21` | 14.8:1 with `OnSurface` | Cards, settings groups |
| `SurfaceVariant` | `#222A30` | 11.2:1 | Rows inside cards, the preview frame |
| `OnSurface` | `#F2F5F7` | — | Primary text |
| `OnSurfaceMuted` | `#A8B4BD` | 7.4:1 on Surface | Meta, captions, disabled help |
| `Walk` | `#1B5E20` | 8.6:1 with white | Walk sign on |
| `Caution` | `#7A5C00` | 7.0:1 with white | Flashing / unverified / walk of unknown age |
| `DontWalk` | `#B71C1C` | 6.2:1 with white | Don't walk |
| `Crossing` | `#0D47A1` | 8.6:1 with white | Crossing mode |
| `Unknown` | `#37474F` | 9.0:1 with white | No signal yet, idle |
| `Hazard` | `#FFD600` | 13.9:1 with black | Vehicle warning banner only |
| `Accent` | `#8AB4F8` | 8.1:1 on Background | Links, Back, Settings — never a state |

`Accent` is a lighter, desaturated blue precisely so it is not mistaken for `Crossing`.

## Spacing, shape, elevation

One 4dp-based scale: **4, 8, 12, 16, 20, 24**. Screen gutter 16. Card padding 20. Gap between cards 12. Gap between
controls 12.

Radius: 28 for the phase card (the one soft, human shape on the screen), 20 for cards and buttons, 12 for rows and the
preview frame. No shadows — elevation is expressed by surface lightness, which survives sunlight better than a shadow.

## Layout

```
┌──────────────────────────────────────┐
│ CrossWise                    ⚙ 56dp  │  top bar: name + quiet meta line
│ crosswise.tflite · GPU · 23 fps      │  labelMedium, muted
├──────────────────────────────────────┤
│  ┌────────────────────────────────┐  │  viewfinder: inset, radius 12,
│  │                                │  │  1dp SurfaceVariant border,
│  │      camera + overlay          │  │  weight(1f) so it yields to
│  │                                │  │  everything else
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ WAITING                        │  │  eyebrow, labelLarge
│  │ DON'T WALK                     │  │  displayLarge — the hero
│  │ Started 4 s ago                │  │  bodyLarge
│  │ ▸ Vehicle approaching, left    │  │  hazard banner, black on amber
│  │ "Don't walk sign."             │  │  caption, muted
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │          Stop assist           │  │  primary, 76dp, full width
│  └────────────────────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐   │  secondary pair, 64dp
│  │ I'm crossing│  │Repeat status │   │
│  └─────────────┘  └──────────────┘   │
└──────────────────────────────────────┘
```

The status card sits **directly above the controls**, not floating over the preview: a thumb reaching the primary
button passes the card, and the eye travels state → action in one move. When the preview is switched off the card
simply grows — the layout has no hole in it.

Settings becomes cards instead of a wall of rows: one card per section (Feedback, Guidance, Detection, Model, Data),
each with a `labelLarge` header, rows of a uniform 56dp, switch on the right, and the value shown inline on sliders.

## Screens

Four tabs, always in the same order, labelled with words rather than icons — an icon has to be learned, and the
people most likely to rely on this app are the least likely to see it clearly. Assist stays mounted underneath the
others, so the camera, the engine and the announcements keep running while the traveler reads the guide.

| Tab | What it is for |
|---|---|
| **Assist** | The live screen. Warnings, viewfinder and scene detail scroll; the phase card and the controls never move. |
| **Practice** | Every cue the app can produce, on demand, indoors. It drives the real feedback engine, not recordings. |
| **Guide** | Safety, how to hold the phone, what each sound and vibration means, troubleshooting, recorded sessions, licences. |
| **Settings** | Unchanged, now reachable as a tab as well as from the top bar. |

### Assist, in priority order

1. **Warnings** — only when they apply, and above everything else, because a clipped warning is a warning nobody
   reads: lens covered, scene too dark, phone flat, frame rate too low for a moving vehicle, no headphones (the
   left/right tones collapse to mono), low battery, baseline model that cannot verify colour.
2. **Viewfinder** — a 160dp strip. It exists for the sighted helper; it is not the product.
3. **Scene** — where the signal is *on a clock face*, how confident the phase is, whether crosswalk markings are in
   view, what else is on the street and at which clock position, which way the traveler is facing, and whether they
   are walking.
4. **Phase card** and **controls** — fixed, never scroll.

### Why clock positions

"Left" and "right" throw away most of what a traveler needs: 11 and 1 o'clock are both nearly ahead, and the
difference decides whether a car is crossing your path or passing behind it. Clock directions are what orientation
and mobility instructors teach and what every other navigation app for blind travelers uses (BlindSquare announces
"entrance at 2 o'clock"), so the app should speak the language its users already have.

### Why a practice screen

A traveler cannot learn the difference between a rising chime and a falling tone while standing at a live curb —
that is the one place where getting it wrong is expensive. Practice is the rehearsal room. No other crossing app
ships one, and for a cue vocabulary this size it is the difference between a feature and a usable feature.

## What must not change

* Merged semantics on the status card, so TalkBack reads it as one announcement, not six fragments.
* `heading()` on screen titles and section headers.
* `Role.RadioButton` / `Role.Switch` on settings rows, labels tied to their control.
* Volume-key shortcuts, the safety notice, and the wording of every announcement.
* The detection overlay's coordinate mapping to the preview's FILL_CENTER crop.
