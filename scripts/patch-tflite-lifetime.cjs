// Keep imported model weights native-owned for the complete interpreter lifetime.
// Nitro's JSArrayBuffer can borrow memory from a JS runtime; shared_ptr alone is insufficient.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../node_modules/react-native-fast-tflite/cpp/HybridTfliteModule.cpp');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes('auto ownedModelData =')) {
  const needle = '  TfLiteModel* model = TfLiteModelCreate(modelData->data(), modelData->size());';
  if (!source.includes(needle)) throw new Error('TFLite model creation changed; review lifetime patch.');
  source = source.replace(needle, '  auto ownedModelData = modelData->isOwner() ? modelData : ArrayBuffer::copy(modelData);\n  TfLiteModel* model = TfLiteModelCreate(ownedModelData->data(), ownedModelData->size());');
  source = source.replace('std::make_shared<HybridTfliteModel>(interpreter, modelData, delegates)', 'std::make_shared<HybridTfliteModel>(interpreter, ownedModelData, delegates)');
  fs.writeFileSync(file, source);
}
// CW-21: the CPU path ran on TFLite's default thread count. The old Kotlin app used 4 threads.
if (!source.includes('TfLiteInterpreterOptionsSetNumThreads')) {
  const optionsNeedle = '  TfLiteInterpreterOptions* options = TfLiteInterpreterOptionsCreate();';
  if (!source.includes(optionsNeedle)) throw new Error('TFLite options creation changed; review thread patch.');
  source = source.replace(optionsNeedle, optionsNeedle + '\n#ifdef __ANDROID__\n  TfLiteInterpreterOptionsSetNumThreads(options, 4);\n#endif');
  fs.writeFileSync(file, source);
}
