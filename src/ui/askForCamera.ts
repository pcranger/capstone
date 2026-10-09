import { Linking } from 'react-native';

// A real Android permission dialog takes longer than this to open and be answered.
const DIALOG_MS = 400;

/**
 * The one camera-permission action (SIM-2). vision-camera reports "can ask" until Android has recorded a second refusal, and
 * a request Android silently refuses resolves false at once with no dialog. So: ask; if the answer comes back false with no
 * time for a dialog, or the request throws, go to the app settings instead of doing nothing.
 * ponytail: timing is a heuristic; the exact signal is Android's own "dialog shown" state, which vision-camera does not expose.
 */
export async function askForCamera(canRequest: boolean, request: () => unknown): Promise<void> {
  if (canRequest) {
    const started = Date.now();
    try {
      if ((await request()) !== false || Date.now() - started > DIALOG_MS) return;
    } catch { /* fall through to the settings screen */ }
  }
  await Linking.openSettings();
}
