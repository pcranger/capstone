> Superseded command wording: the subsequent user-requested revision removes the conversational help phrase.
> Current command: **manual**, alias **man**. Historical recognition results below are retained as evidence, not current instructions.
> Developer now has live class counts, labelled tracks and telemetry; User has compact status/posture guidance.
> Follow-up regression: 234 tests / 26 suites pass, plus typecheck and lint.

# Voice and usability audit — 6 October 2026

## Conclusion and scope

The user's report was valid. The previous 216-test regression and successful installation did **not** establish working recognition on this iPhone. This audit found a hard-coded locale failure, a shared audio-session conflict, unclear recovery, weak command wording, unnecessary User-camera controls, and two map/planning presentation problems. These have been corrected. Fully hands-free pedestrian navigation is still unfinished; automatic route-step advancement, crossing completion and reliable roadside inference are not delivered by this increment.

General precautions remain in Settings. Immediate operational failures remain visible and actionable: hiding microphone/camera/location failures would misrepresent whether guidance is operating.

## Observed failures and changes

1. **“Australian voice unavailable.”** Native inspection on the connected iPhone 15 Pro, iOS 26.6.1, found `en-AU` supported and available, but `supportsOnDeviceRecognition=false`. `en-US` was available with on-device recognition. The app incorrectly required en-AU. It now prefers en-AU, then selects another available offline English recognizer; unavailable initialization is retried three times. It never silently enables cloud recognition. Speech output voices and recognition assets are different facilities.
2. **Readiness tone changed the recording session.** Actual native logs contained audio-session error 561017449 when the tone library tried to apply playback configuration during microphone capture. TonePlayer now disables that library's automatic session management before creating its AudioContext. The recognition adapter owns capture configuration and restores the prior session after completion. The post-fix live run showed repeated normal recognition endings and no matching session-configuration errors. Human audibility/recognition is still an acceptance item.
3. **Misheard commands could become destinations.** The recognizer returned “Held” for “Help” and “And journey” for “End journey.” Bare-text destination fallback was removed; unknown speech now receives a concise command hint and never automatically searches. More contextual phrases were added. The advertised help command is “what can I say”; “stop navigation” is preferred for ending guidance.
4. **Failure and recovery were difficult to find.** Voice status persists on both camera and map, with Retry voice and Voice help. Settings starts with Voice help, a Read voice instructions action, exact commands and recovery. When speech is disabled, help offers Enable spoken guidance.
5. **User-camera controls were cluttered.** Routine buttons now sit behind More controls. Map, Settings and voice controls remain accessible. Unfinished-crossing recovery is never hidden. Developer controls remain available. Removing every button would remove the current fallback and unfinished workflow controls.
6. **Touch versus speech race.** Actual destination-action callbacks stop pending voice work, including accessibility activation that does not produce `onTouchStart`. Merely opening the map does not cancel voice.
7. **Route failure lost its explanation.** The planner now preserves the journey's specific failure, such as moving away from the planned start, instead of always replacing it with a generic location message.
8. **Map status squeezed into a narrow column.** A real simulator screenshot with an active route showed the location accuracy text wrapping almost character by character alongside three controls. The status now gets its own full-width row.

## Inside the app

Open **Settings → Voice help**, or use Voice help beside a recognition failure. The instructions explain permissions, the listening tone, exact commands, choosing results, search versus automatic navigation, saving aliases, stopping/restarting listening, and when the app is not listening. A spoken short guide is available at the top.

| Say after the tone | Expected behavior |
|---|---|
| Navigate to Sydney Town Hall | Resolve destination; start a route if unambiguous and location qualifies |
| Search for a library | Search without starting navigation |
| First / second / third | Choose the corresponding offered result |
| Start / confirm | Start the selected planned destination |
| Save as Home | Save the selected place or destination under an alias; not current GPS |
| Navigate to Home | Resolve the saved alias |
| Repeat | Repeat current applicable guidance |
| Pause / resume | Pause/resume an existing journey |
| Stop navigation | End the journey |
| Cancel / retry | Cancel or retry the current applicable operation |
| What can I say | Hear the short command guide |
| Stop listening | Turn voice off; restart with the Voice button |

“End journey,” “help” and “voice help” remain aliases. There is no wake word or background microphone. Recognition pauses during speech, command execution, Settings and backgrounding. First-use operating-system consent still requires interaction. Unknown phrases cannot direct road crossing.

## Evidence, not a blanket pass

Evidence folder: `../../research/2026-10-06-voice-audit/` relative to this document's directory. It contains capability JSON, native fixture outputs and the generated synthetic audio. No personal microphone recording was retained.

### Actual iPhone speech tests

Eight audio files were generated with macOS Daniel at 145 words/minute, converted to 16 kHz mono PCM, copied over USB and recognized by the phone's installed native recognition stack. The explicit USB probe pauses live listening, recognizes fixture files without executing any commands, writes results, then resumes voice. File recognition checks the recognizer, not microphone acoustics or a person's accent.

| Iteration | Exact transcript matches | Failure / interpretation |
|---|---:|---|
| Original phrases | 6/8 | “End journey” → “And journey”; “Help” → “Held” |
| Added contextual commands | 7/8 | “Help” still → “Held” |
| Longer stop/help phrases | 7/8 | “Voice help” → “Voiceover held” |
| Stop navigation + What can I say | 8/8 | All eight synthetic phrases exact |

This was iterative tuning on one synthetic speaker, **not** an independent accuracy benchmark. Failed outputs are preserved in `phone-voice-probe-result.json`, `phone-voice-probe-hints.json`, and `phone-voice-probe-long-commands.json`; final output is `phone-voice-probe-help-sentence.json`.

The live microphone lifecycle was then examined independently. `phone-live-after-audio-fix.json` reports en-US, microphone input, a normal silent/no-speech ending and no current app error. Native logs before and after the fix were inspected for audio-session failures. This does not establish that spoken commands, the tone, speaker playback or Bluetooth work for the user. That needs the pending human spoken check.

### Simulator walkthrough

On iPhone 17 Pro / iOS 26.2 simulator:

- Opened User camera; tested More controls / Hide controls, persistent recognition error and Voice help.
- Inspected Settings instructions and recovery through accessibility elements; tested large text at size 7 and restored size 3.
- Opened the full-screen Google map and searched Sydney Town Hall through the real Places service.
- Selected the result and checked its address; opened the existing saved Town Hall test entry without deleting it.
- First routing attempt failed while Device Hub location was None. Enabling a Sydney fixture allowed routing. A fixed one-shot location became stale; continuous simulated updates were used for lifecycle checks. This was a test-environment failure, not evidence that outdoor GPS works.
- Changing the synthetic origin after planning correctly prevented starting the old route. This exposed the generic-message bug described above.
- Replanned from continuous fresh Sydney fixes: 265 m, about 4 minutes. Started the route, paused, opened the map, observed the retained marker and about 5 m reported accuracy, resumed the first instruction, paused and ended. Destination search returned afterward.
- No simulated crossing was used to claim road safety. Simulator camera and offline speech failures are expected environment limitations.

### Software and build checks

231 tests across 25 suites pass. TypeScript and Expo lint pass. Coverage includes native locale fallback/permission/cancellation, final-result and audio-end ordering, silent rearming, serialized speech/listening, unknown-command rejection, background recovery, destination request races, accessibility-action cancellation, specific route error propagation, compact controls, crossing recovery, help actions and existing perception/navigation regressions.

Final Release builds succeeded for phone and simulator, were installed and launched. Final simulator inspection confirmed Voice help at the top of Settings with Read voice instructions, and a readable full-width location accuracy row. Simulator location was restored to None and text size to 3. The final phone snapshot `phone-final-installed-status.json` reports en-US, microphone input, listening and no current error; its last native error is the preceding ordinary no-speech timeout. One concurrent simulator build encountered Xcode's shared build-database lock; it was rerun sequentially. The installed phone's final JavaScript bundle SHA-256 is `b6fef4b6868efacbd3e5e4eff1644dd7aeea0c3ff39b3abd76c8c84972d55644`.

## Novice-user and developer questions

Status meanings: **verified** names the evidence; **implemented** may still need human acceptance; **open** is not a pass.

| Question asked during the audit | Answer / evidence |
|---|---|
| 1. Can I open the app without choosing a mode? | Existing automatic User entry; simulator verified |
| 2. Must I tap Start to enter voice? | Automatic foreground startup implemented; human audible welcome pending |
| 3. Are initial permission dialogs unavoidable? | Yes, OS consent; documented, not bypassed |
| 4. Why does an Australian recognizer fail in Australia? | Locale support is not offline asset availability; actual phone capability proved the difference |
| 5. Can another installed English recognizer work? | Actual phone en-US fixture recognition verified |
| 6. Does it secretly send speech to a server? | Offline-only requests; no online fallback in this path |
| 7. Is downloading a speaking voice the same fix? | No; recovery instructions distinguish output from recognition |
| 8. Can I see why voice failed? | Persistent camera/map status and Settings diagnostics; UI regression verified |
| 9. Can I retry without restarting everything? | Retry voice action verified; poisoned native shutdown still requires reopening |
| 10. Does disabled speech leave a misleading mic button? | Voice settings action and Enable spoken guidance; regression verified |
| 11. How do I know when to speak? | Tone after audio starts; sequencing verified, physical audibility pending |
| 12. Will it hear me while it talks? | No; explicitly documented; serialization regression verified |
| 13. Will the tone interrupt the microphone? | Native conflict fixed; no matching error in post-fix live run; human check pending |
| 14. Can I interrupt speech with a voice command? | Not implemented; touch remains available |
| 15. What happens if I remain silent? | Quiet bounded rearming; software and native no-speech checks |
| 16. Is this an always-on wake-word assistant? | No; Settings explains bounded foreground turns |
| 17. Where can I learn commands without external docs? | Settings → Voice help, spoken guide at top |
| 18. Does the advertised help phrase recognize correctly? | What can I say exact in synthetic phone test; human check pending |
| 19. Can a misheard help command start a random route? | Explicit destination verbs required; unknown text rejected in regression |
| 20. Is a single known destination enough? | Automatic route start supported; controller test; real spoken end-to-end pending |
| 21. Does Search accidentally start walking? | No; requires Start/Confirm; regression and in-app instructions |
| 22. Are ambiguous results distinguishable? | Names/addresses and first/second/third; two-choice prompt regression |
| 23. Does Save mean my current coordinates? | No, selected destination/place; explicitly documented |
| 24. Can I use saved names later? | Alias resolution regression; real saved-place UI lookup verified |
| 25. Does Pause claim success without a journey? | Corrected response; regression verified |
| 26. Can Resume accidentally restart an active journey? | Already-running response; regression verified |
| 27. Is Stop navigation understood? | Exact phone synthetic result; action parser regression |
| 28. Can touch race an old voice result? | Callback cancellation and generation fencing; regression verified |
| 29. Does VoiceOver activation also cancel old work? | Handler-level regression verified; physical VoiceOver experience open |
| 30. Does opening the map stop voice unnecessarily? | View-only map opening preserves voice; instruction documented |
| 31. Why are some buttons still present? | Fallback plus incomplete automatic transitions; routine User-camera controls collapsed |
| 32. Can crossing recovery disappear inside More controls? | No; compact unfinished-crossing regression verified |
| 33. Can location survive a route pause? | Shared owner regression and simulator marker/accuracy verified |
| 34. Can stale location start guidance? | Freshness gate rejects it; simulator stale fixture demonstrated rejection |
| 35. Will a changed route origin produce useful instructions? | Specific failure is now preserved; regression verified |
| 36. Is map text readable with route controls? | Crowding found visually and corrected to full-width status row |
| 37. Does large text remain navigable? | Settings inspected at large size; exhaustive all-device typography remains open |
| 38. Does backgrounding stop listening? | Lifecycle cancellation regression; physical interruption sequence remains open |
| 39. Does the app decide the correct roadside? | No; unresolved research/field requirement |
| 40. Will it automatically finish every route step/crossing? | No; manual controls remain and help discloses this |
| 41. Is detection of no cars proof that crossing is clear? | No such decision is delivered by this work |
| 42. Does it work in wind, traffic or with an Australian speaker? | Not established by synthetic fixtures; field acceptance open |
| 43. Do VoiceOver, Bluetooth, silent switch and calls coexist? | Physical matrix still open; no blanket claim |
| 44. Are real phone recognition and parser tests the same? | No; native fixture, microphone lifecycle and intent/action tests are reported separately |
| 45. Was the complete trip tested solely by a blind user? | No; must not describe this audit as such a study |

## Next acceptance and implementation gates

1. On the installed phone, after the tone say **What can I say**. Verify the guide is audible, a new tone follows, and **Navigate to Sydney Town Hall** is recognized. Stay stationary for this interaction test.
2. Test real speaker and headset audio, Australian accent, quiet/noisy conditions, silence, interruptions and failed permissions. Record recognized text/action outcomes with participant consent; do not silently collect microphone audio.
3. Test VoiceOver focus order, labels, activation and speech overlap on the physical phone; inspect all enlarged-text screens and destinations with long names.
4. Validate foreground/background/pause GPS on a supervised walking route. Simulator cadence cannot establish native street behavior.
5. Only then proceed with automatic instruction progress and crossing preparation. Preserve evidence-based abstention for unclear road geometry; do not infer crossing clearance from an empty detector frame.

Sources used: [Apple on-device recognition capability](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition), [React Native Audio API session management](https://docs.swmansion.com/react-native-audio-api/docs/system/audio-manager/), [Apple Dictation settings](https://support.apple.com/guide/iphone/dictate-text-iph2c0651d2/ios), and the installed speech-recognition module's iOS implementation. Dictation setup is a recovery suggestion, not a guarantee that iOS will install a particular recognizer.
