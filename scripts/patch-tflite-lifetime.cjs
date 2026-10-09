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
