const fs = require('fs');
const os = require('os');
const path = require('path');

// Runs the real install-time patch script against pristine copies of the three react-native-fast-tflite sources.
const { patch } = jest.requireActual('../scripts/patch-tflite-lifetime.cjs') as { patch: (baseDir?: string) => void };

const SOURCES = ['HybridTfliteModule.cpp', 'TfliteHelpers.cpp', 'TfliteHelpers.hpp'];
let base: string;
const cppFile = (name: string) => path.join(base, 'node_modules/react-native-fast-tflite/cpp', name);
const read = (name: string) => fs.readFileSync(cppFile(name), 'utf8');

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tflite-patch-'));
  fs.mkdirSync(path.dirname(cppFile('x')), { recursive: true });
  for (const name of SOURCES) {
    // Git on Windows may check the fixtures out with CRLF; the installed package uses LF.
    const text = fs.readFileSync(path.join(process.cwd(), '__tests__/tfliteSources', name), 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(cppFile(name), text);
  }
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe('react-native-fast-tflite GPU kernel cache patch', () => {
  it('turns on GPU kernel serialization with a per-model token', () => {
    patch(base);
    const helpers = read('TfliteHelpers.cpp');
    expect(helpers).toContain('TFLITE_GPU_EXPERIMENTAL_FLAGS_ENABLE_SERIALIZATION');
    expect(helpers).toContain('delegateOptions.serialization_dir = cacheDir.c_str();');
    expect(helpers).toContain('delegateOptions.model_token = token.c_str();');
    expect(helpers).toContain('fnv1a64');
    expect(helpers).toContain('14695981039346656037ULL');
    expect(helpers).toContain('1099511628211ULL');
    expect(helpers).toContain('"cw-" + std::to_string(size)');
    expect(helpers).toContain('/proc/self/cmdline');
    expect(helpers).toContain('/data/data/');
    expect(helpers).toContain('access(path.c_str()');
    expect(helpers).toContain('TfLiteDelegate* getAndroidGPUDelegate(const void* data, size_t size) {');
    expect(read('TfliteHelpers.hpp')).toContain('TfLiteDelegate* getAndroidGPUDelegate(const void* data, size_t size);');
  });

  it('passes the model bytes to the GPU delegate', () => {
    patch(base);
    const module = read('HybridTfliteModule.cpp');
    expect(module).toContain('getDelegate(TensorflowModelDelegate delegateType, const void* modelData, size_t modelSize)');
    expect(module).toContain('return getAndroidGPUDelegate(modelData, modelSize);');
    expect(module).toContain('getDelegate(delegateType, ownedModelData->data(), ownedModelData->size())');
  });

  it('keeps the lifetime and 4-thread patches', () => {
    patch(base);
    const module = read('HybridTfliteModule.cpp');
    expect(module).toContain('auto ownedModelData = modelData->isOwner()');
    expect(module).toContain('interpreter, ownedModelData, delegates');
    expect(module).toContain('TfLiteInterpreterOptionsSetNumThreads(options, 4);');
  });

  it('changes nothing on a second run', () => {
    patch(base);
    const first = SOURCES.map(read);
    patch(base);
    expect(SOURCES.map(read)).toEqual(first);
  });

  it('throws when a needle text has changed', () => {
    const file = cppFile('TfliteHelpers.cpp');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('TfLiteDelegate* getAndroidGPUDelegate() {', 'TfLiteDelegate* getAndroidGPUDelegate(int x) {'));
    expect(() => patch(base)).toThrow(/GPU delegate definition changed/);
  });
});
