/**
 * Whether the app may use the camera, and how to ask. CrossWiseApp keeps this current from the vision-camera permission
 * hook (which itself re-reads the permission when the app returns to the foreground); the controller only reads it, so
 * voice "Start" can be refused with the same rule as the button.
 */
export const cameraAccess: { has: boolean; ask: () => void } = { has: true, ask: () => undefined };
