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

Three typefaces, chosen in Settings, because this app has two audiences and they do not want the same thing.

| Option | Face | For |
|---|---|---|
| **Modern** (default) | Inter | The interface face of the last decade — what a sighted user expects a 2026 app to look like. Tall x-height, tight spacing, neutral. |
| **Classic** | Tinos | Metric-compatible with Times New Roman, and redistributable (Apache 2.0). For readers who simply prefer a serif. |
| **Hyperlegible** | Atkinson Hyperlegible | Braille Institute, OFL 1.1. Drawn for low vision: `I l 1`, `O 0`, `a e s` are given distinct shapes and asymmetric terminals. |

Each option is rendered *in its own face* in the settings list, so the choice is visible rather than described. Two
weights per family (400/700) keeps the rhythm uniform whichever is picked.

| Slot | Size / weight | Used for |
|---|---|---|
| `displayLarge` | 52sp / 700 | The phase word, **only** when "Large status text" is on |
| `displayMedium` | 34sp / 700 | The phase word, default |
| `headlineMedium` | 26sp / 700 | Screen titles |
| `titleLarge` | 20sp / 700 | Card headings, primary button |
| `titleMedium` | 17sp / 700 | Setting rows, secondary buttons |
| `bodyLarge` | 16sp / 400 | Detail lines |
| `bodyMedium` | 15sp / 400 | Captions, help text |
| `labelLarge` | 13sp / 700, tracked, uppercase | Eyebrows, section headers |
| `labelMedium` | 12sp / 400 | Debug meta, tab labels |

The phase word came down from 56sp to 34sp. At 56sp it was a billboard that covered the street; the people who
genuinely need a billboard now turn one on in Settings, and everyone else gets their camera back.

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

Camera-first, following what current mobile design actually does: a full-bleed live surface with floating glass
panels anchored in the thumb zone, rather than a form with a video thumbnail in it.

```
┌──────────────────────────────────────┐
│ CrossWise                       (⚙)  │  over a top scrim, not a bar
│ crosswise.tflite · GPU · 23 fps      │
│                                      │
│                                      │
│          camera, full bleed          │  the surface, not a widget
│          + detection overlay         │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ CHECK BEFORE YOU RELY ON IT · 2│  │  amber, collapsed to one line
│  ├────────────────────────────────┤  │
│  │ ● WAITING            Details   │  │  state as a lit dot, not a block
│  │ DON'T WALK                     │  │  34sp
│  │ Started 4 s ago                │  │
│  └────────────────────────────────┘  │  glass: 90% dark + hairline
│  ┌────────┐ ┌──────────┐ ┌────┐      │
│  │ Start  │ │ Crossing │ │ ⟳  │      │  56dp pills, single line
│  └────────┘ └──────────┘ └────┘      │
│  ◉ Assist  ▶ Practice  ⓘ Guide  ⚙    │  icon + label, 56dp
└──────────────────────────────────────┘
```

Three things make this work without losing the accessibility:

* **State is a lit dot beside the words**, not a colour block behind them. The panel can then stay sheer enough to
  see the street through, and colour still carries the meaning.
* **Scrims, not bars.** A gradient top and bottom keeps white text legible over a bright sky while showing the view.
* **Short labels, full announcements.** The button reads "Start"; TalkBack still says "Start assist". Shrinking a
  control should never shrink what a blind user is told.

Detail (the scene panel, the full warning list) is behind a *Details* toggle, so the default screen is quiet and the
information is one tap away — the bottom-sheet pattern, without hiding anything behind a gesture nobody discovers.

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
