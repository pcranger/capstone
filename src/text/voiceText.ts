/** Voice-control wording added by the blind-user review (items 10 and 11). New text lives here, not in strings.ts. */
export const VT = {
  /** First "cancel" or "stop" during a crossing; the same word again within CONFIRM_WINDOW_MS acts. */
  confirmAgain: (word: string) => `Say ${word} again to stop crossing warnings.`,
  crossNeedsHelp: 'Start camera help first.',
  alreadyOff: 'Camera help already off.',
  crossAlready: 'Crossing guidance already on.',
  /** Always-visible mic button above the dock. The label is what a screen reader reads. */
  toggleOn: 'Voice commands, on',
  toggleOff: 'Voice commands, off',
  toggleHint: 'Double-tap to switch voice commands on or off.',
  toggleOnText: 'Voice on',
  toggleOffText: 'Voice off',
  manual: 'Start. Pause. Resume. Repeat. Retry. Check again. Cross. Stop. Finish crossing. Cancel. Stop listening. Use the Voice commands button above the buttons, or double-tap the camera, to turn listening on or off.',
  sayLines: [
    '“Check again” works like “Retry”. “Cross” is the same as the Cross button.',
    '“Stop” turns camera help off. During a crossing, say “stop” or “cancel” twice within 4 seconds.',
  ],
  toggleHelpHint: 'The Voice commands button above the buttons turns listening on or off. It stays reachable with TalkBack or VoiceOver.',
};
/** How long the second "cancel" or "stop" has to follow the spoken question. */
export const CONFIRM_WINDOW_MS = 4_000;
