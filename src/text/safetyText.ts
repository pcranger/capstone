/** All spoken text added by the blind-user safety fixes (cw-safety). Kept apart from strings.ts on purpose. */
export const T = {
  /** Spoken, urgent, whenever camera help stops for any reason. */
  assistStopped: 'Camera help off. Vehicle warnings stopped.',
  /** One question for the Stop button and the voice word "stop". */
  stopConfirm: 'Stop vehicle warnings? Press or say stop again to confirm.',
  backConfirm: 'Press Back again to close CrossWise',
  backInApp: 'CrossWise is back. Press Start to check again.',
  welcomeSafety: 'CrossWise helps you check for cars, but it can miss them. Always use your cane and your own judgement.',
  welcomeStart: 'Say Start, or press the big button at the bottom.',
  gettingReady: 'Getting ready.',
  stillGettingReady: 'Still getting ready. The first time can take up to ten seconds.',
  notWorking: 'Camera help is not working. Close and reopen CrossWise.',
  ready: 'Ready',
  notReady: 'Not ready yet, please wait',
  cameraOff: 'Camera is off. Press Allow camera at the bottom, or say Allow camera.',
  askingCamera: 'Asking for the camera.',
  stillCantSee: 'Still can’t see. No vehicle warnings.',
  /** The big button changed meaning: say what it does now. */
  nextButton: (label: string, lead = '') => `${lead}Next button: ${label}`,
  cameraHelpOnLead: 'Camera help on. ',
};
