// Patches react-native-fast-tflite sources at install time. Every edit is idempotent:
// skipped when its result is already present, and throws when neither the old nor the new text is found.
const fs = require('fs');
const path = require('path');

function patch(baseDir = path.join(__dirname, '..')) {
  const cppDir = path.join(baseDir, 'node_modules/react-native-fast-tflite/cpp');
  const edit = (name, edits) => {
    const file = path.join(cppDir, name);
    let source = fs.readFileSync(file, 'utf8');
    const before = source;
    for (const [needle, replacement, label, guard = replacement] of edits) {
      if (source.includes(guard)) continue;
      if (!source.includes(needle)) throw new Error(`${label} changed; review patch.`);
      source = source.replace(needle, () => replacement);
    }
    if (source !== before) fs.writeFileSync(file, source);
  };

  // Keep imported model weights native-owned for the complete interpreter lifetime.
  // Nitro's JSArrayBuffer can borrow memory from a JS runtime; shared_ptr alone is insufficient.
  // CW-21: the CPU path ran on TFLite's default thread count. The old Kotlin app used 4 threads.
  // Cache compiled GPU kernels per model so start-up skips the ~10 s OpenCL recompile after the first run.
  edit('HybridTfliteModule.cpp', [
    ['  TfLiteModel* model = TfLiteModelCreate(modelData->data(), modelData->size());',
      '  auto ownedModelData = modelData->isOwner() ? modelData : ArrayBuffer::copy(modelData);\n  TfLiteModel* model = TfLiteModelCreate(ownedModelData->data(), ownedModelData->size());',
      'TFLite model creation', 'auto ownedModelData ='],
    ['std::make_shared<HybridTfliteModel>(interpreter, modelData, delegates)',
      'std::make_shared<HybridTfliteModel>(interpreter, ownedModelData, delegates)', 'TFLite model wrapper',
      'std::make_shared<HybridTfliteModel>(interpreter, ownedModelData, delegates)'],
    ['  TfLiteInterpreterOptions* options = TfLiteInterpreterOptionsCreate();',
      '  TfLiteInterpreterOptions* options = TfLiteInterpreterOptionsCreate();\n#ifdef __ANDROID__\n  TfLiteInterpreterOptionsSetNumThreads(options, 4);\n#endif',
      'TFLite options creation', 'TfLiteInterpreterOptionsSetNumThreads'],
    ['TfLiteDelegate* getDelegate(TensorflowModelDelegate delegateType) {',
      'TfLiteDelegate* getDelegate(TensorflowModelDelegate delegateType, const void* modelData, size_t modelSize) {',
      'getDelegate signature'],
    ['      return getAndroidGPUDelegate();', '      return getAndroidGPUDelegate(modelData, modelSize);', 'GPU delegate call'],
    ['    TfLiteDelegate* delegate = getDelegate(delegateType);',
      '    TfLiteDelegate* delegate = getDelegate(delegateType, ownedModelData->data(), ownedModelData->size());',
      'getDelegate call site'],
  ]);

  edit('TfliteHelpers.hpp', [
    ['TfLiteDelegate* getAndroidGPUDelegate();', 'TfLiteDelegate* getAndroidGPUDelegate(const void* data, size_t size);',
      'GPU delegate declaration'],
  ]);

  edit('TfliteHelpers.cpp', [
    ['#include <tflite/delegates/nnapi/nnapi_delegate_c_api.h>',
      '#include <tflite/delegates/nnapi/nnapi_delegate_c_api.h>\n#include <unistd.h>\n#include <cstdint>\n#include <cstdio>\n#include <mutex>\n#include <set>',
      'Android includes', '#include <set>'],
    ['TfLiteDelegate* getAndroidGPUDelegate() {', GPU_HELPERS + 'TfLiteDelegate* getAndroidGPUDelegate(const void* data, size_t size) {',
      'GPU delegate definition', 'static uint64_t fnv1a64('],
    ['  TfLiteGpuDelegateOptionsV2 delegateOptions = TfLiteGpuDelegateOptionsV2Default();',
      '  TfLiteGpuDelegateOptionsV2 delegateOptions = TfLiteGpuDelegateOptionsV2Default();\n' + GPU_SERIALIZATION,
      'GPU delegate options', 'TFLITE_GPU_EXPERIMENTAL_FLAGS_ENABLE_SERIALIZATION'],
  ]);
}

// The delegate options keep raw const char*, so the strings must outlive the delegate: std::set nodes never move.
const GPU_HELPERS = `#ifdef ANDROID
// CW: 64-bit FNV-1a. Keeps the 416 and 640 models from ever sharing a kernel cache.
static uint64_t fnv1a64(const void* data, size_t size) {
  const uint8_t* bytes = static_cast<const uint8_t*>(data);
  uint64_t hash = 14695981039346656037ULL;
  for (size_t i = 0; i < size; i++) {
    hash ^= bytes[i];
    hash *= 1099511628211ULL;
  }
  return hash;
}

// App cache folder, or "" when it can't be found or written (then no serialization, same as before).
static const std::string& gpuCacheDir() {
  static const std::string dir = [] {
    char name[256] = {0};
    FILE* f = fopen("/proc/self/cmdline", "r");
    if (f == nullptr)
      return std::string();
    size_t n = fread(name, 1, sizeof(name) - 1, f);
    fclose(f);
    if (n == 0 || name[0] == '\\0')
      return std::string();
    std::string path = std::string("/data/data/") + name + "/cache";
    return access(path.c_str(), W_OK | X_OK) == 0 ? path : std::string();
  }();
  return dir;
}

#endif // ANDROID

`;

const GPU_SERIALIZATION = `  // CW: cache compiled GPU kernels per model (first run compiles, later runs load from disk).
  const std::string& cacheDir = gpuCacheDir();
  if (!cacheDir.empty()) {
    char hex[17];
    snprintf(hex, sizeof(hex), "%016llx", static_cast<unsigned long long>(fnv1a64(data, size)));
    static std::mutex tokenMutex;
    static std::set<std::string> tokens;
    std::lock_guard<std::mutex> lock(tokenMutex);
    const std::string& token = *tokens.insert("cw-" + std::to_string(size) + "-" + hex).first;
    delegateOptions.experimental_flags |= TFLITE_GPU_EXPERIMENTAL_FLAGS_ENABLE_SERIALIZATION;
    delegateOptions.serialization_dir = cacheDir.c_str();
    delegateOptions.model_token = token.c_str();
  }
`;

if (require.main === module) patch();
module.exports = { patch };
