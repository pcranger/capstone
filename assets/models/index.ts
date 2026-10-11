/**
 * Models bundled with the app. React Native can only bundle files it sees in a static `require`, so each
 * `.tflite` placed in this folder needs one line here. The default is crosswise-416.tflite, the trained CrossWise detector at 416 px.
 *
 * Other models can be imported in Settings or copied into the CrossWise folder with the Files app.
 */
export const BUNDLED_MODELS: { name: string; module: number }[] = [
  { name: 'yolo26n-bdd640.tflite', module: require('./yolo26n-bdd640.tflite') },
  { name: 'yolo26s-960.tflite', module: require('./yolo26s-960.tflite') },
  // ml/kaggle_output/artifacts/crosswise_v1_best.tflite: the trained pedestrian-signal detector (9 classes).
  { name: 'crosswise.tflite', module: require('./crosswise.tflite') },
  // Same weights re-exported at 416 px with a raw [1, 13, 3549] head (no TopK/NMS ops in the graph) so the whole
  // network runs on the Android GPU. The default (CW-23); see Documents/Whale/Secretary/drafts/capstone/models/EXPORT.md.
  { name: 'crosswise-416.tflite', module: require('./crosswise-416.tflite') },
  // The COCO baseline: vehicles and generic lights, colors announced as unverified.
  { name: 'yolo26n.tflite', module: require('./yolo26n.tflite') },
];

