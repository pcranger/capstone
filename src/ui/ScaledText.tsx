import { Text as NativeText, type TextProps, useWindowDimensions } from 'react-native';

/** Refresh native text measurement when Dynamic Type changes while the app is open.
 * On the tested iOS/Fabric build, glyphs resized before their existing layout was invalidated.
 * Recreate only the text node, preserving the camera, map, journey and scroll containers.
 */
export function Text(props: TextProps) {
  const { fontScale } = useWindowDimensions();
  return <NativeText key={fontScale} {...props} />;
}
