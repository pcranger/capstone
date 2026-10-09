# CrossWise UI design

The visual and interaction system for the shared Expo / React Native app (`src/ui`). Screens are checked against it.

## Who is looking at the screen

In this order:

1. **A low-vision traveler** at a curb, outdoors, phone at chest height, maybe one hand on a cane. They have some usable
   vision, which is why pixels matter. They need one answer, large: what is happening right now?
2. **A blind traveler** using TalkBack. They hear the layout. Visual changes must not disturb reading order, headings
   or announcements.
3. **A sighted helper or examiner** checking the app against reality.

## Principles

1. **State first.** The camera fills the Journey screen; the state banner and one primary button sit in the thumb zone.
2. **Colour carries meaning, never decoration.** Green, amber, red, blue and grey mean walk, caution, don't walk,
   crossing and unknown. Chrome is neutral slate. Accent blue is for links and Back, never a state.
3. **One type scale, no local sizes.** Every text takes a named style; nothing hardcodes `fontSize`.
4. **Everything scales.** Sizes in `sp`; containers grow with their content and do not clip at 200% font scale.
5. **Big, separated targets.** 56 dp for primary controls and Back, 48 dp minimum for secondary ones, 8 to 12 dp apart.
6. **Contrast above the bar.** At least 7:1 for state text and body text, 4.5:1 everywhere else.
7. **Motion is optional.** Anything that animates respects the system Reduce Motion setting.
8. **One glossary.** "Camera help" is the camera on/off feature; "Crossing" is the crossing mode. The same words are
   used on buttons, in the Guide and in announcements.

## Type

Three typefaces, chosen in Settings: Modern (Inter, default), Classic (Tinos) and Hyperlegible (Atkinson
Hyperlegible). Each is shown in its own face in the list. Two weights per family (400 and 700).

Type scale: **15 / 17 / 20 / 26 / 34 sp**.

| Slot | Size | Used for |
|---|---|---|
| `bodyMedium` | 15 | Captions, help text, hints |
| `titleMedium` | 17 | Setting rows, secondary buttons, section toggles |
| `titleLarge` | 20 | Headings (sentence case), primary button |
| `headlineMedium` | 26 | Screen titles |
| `displayMedium` | 34 | The state word |

Headings are sentence case ("Voice help", not "VOICE HELP"), 20 sp, and carry the header role.

## Colour

Dark only: readable at night, easy on an OLED screen, and not a lamp in the traveler's face.

| Token | Hex | Meaning |
|---|---|---|
| `Background` | `#0B0F12` | App ground |
| `Surface` | `#161C21` | Cards, settings groups |
| `SurfaceVariant` | `#222A30` | Rows inside cards |
| `OnSurface` | `#F2F5F7` | Primary text |
| `OnSurfaceMuted` | `#A8B4BD` | Captions, meta |
| `Walk` | `#1B5E20` | Walk sign on |
| `Caution` | `#7A5C00` | Flashing / unverified |
| `DontWalk` | `#B71C1C` | Don't walk |
| `Crossing` | `#0D47A1` | Crossing mode |
| `Unknown` | `#37474F` | No signal yet, idle |
| `Hazard` | `#FFD600` | Hazard banner only |
| `Accent` | `#8AB4F8` | Links, Back, never a state |

## Spacing and shape

4-point spacing: 4, 8, 12, 16, 20, 24. Gutter 16, gap between cards 12, gap between controls 8 to 12.
Radius: **12** for rows and small parts, **18** for cards and buttons, **pill** for the dock and chips. No shadows;
elevation is surface lightness.

## Screens

There is no tab bar and no router. `CrossWiseApp` owns one **Journey** screen: a full-size camera with a directly
reachable full-screen Google map. Settings and Help open over it so the one camera stays mounted.

* **Hazard banner.** A yellow (`Hazard`) banner with black text for a vehicle warning. It is the only place that
  colour is used.
* **State banner.** One banner says what the app is doing (camera off, waiting, walk, don't walk, crossing). When the
  camera is off a card says so and names the way to start it.
* **One primary dock button**, 56 dp, which cycles by state: **Start camera help**, then **I'm crossing**, then
  **I'm on the footpath**. Secondary actions sit under More controls.
* **Map.** The bottom destination sheet holds search, saved places and route review; Start journey is pinned at its
  foot.
* **Settings.** Cards in a fixed order: Feedback, Display, Help, Manual, Precautions, Advanced (Developer mode asks
  for confirmation). Manual and Precautions expand and collapse.
* **Guide.** Opened from Settings. Each section is a collapsible heading (button, `expanded` state, expand-more or
  expand-less icon); Voice help starts open, the rest closed. About holds the Google Maps note and links.
* **Voice help.** Heading "Say", one command per line, then a collapsed "If voice fails" with the recovery steps.

## Accessibility behaviour

* Live regions are **polite** only. Nothing interrupts speech except the spoken safety cues.
* Merged semantics on the state banner, so TalkBack reads it as one announcement.
* Screen titles and section headings use the header role.
* Back is the same 56 dp button on every screen, named as it reads on screen.
* A control's accessibility name matches its visible text (for example the speech preview buttons use the sample text).
* Reduce Motion is respected; no animation is required to understand a state.

## What must not change

* Merged semantics on the state banner.
* Header role on screen titles and section headings.
* Switch and radio roles on settings rows, with labels tied to their control.
* The safety notice and the wording of every announcement.
* The detection overlay's coordinate mapping to the preview's crop.
