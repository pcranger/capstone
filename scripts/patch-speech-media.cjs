// Speech and earcons share Android's media-volume stream. Never change system volume.
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../node_modules/expo-speech/android/src/main/java/expo/modules/speech/SpeechModule.kt');
let source = fs.readFileSync(file, 'utf8');
if (!source.includes('// CrossWise media audio policy')) {
  const needle = '          _textToSpeech!!.setOnUtteranceProgressListener';
  if (!source.includes(needle)) throw new Error('Expo Speech initialization changed; review media audio policy.');
  source = source.replace(needle, `          // CrossWise media audio policy
          _textToSpeech!!.setAudioAttributes(android.media.AudioAttributes.Builder()
            .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build())
${needle}`);
  fs.writeFileSync(file, source);
}
