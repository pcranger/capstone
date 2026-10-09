const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = 'gemini-2.5-flash';

/** One labelled view: the direction the traveler pointed and a JPEG of what the camera saw, base64. */
export interface CapturedView {
  direction: string;
  jpegBase64: string;
}

/**
 * "Describe what is around me": sends a few camera views to Gemini and returns one short spoken answer.
 *
 * The prompt is adapted from `GeminiVlmService` in the AN-S3 project (UOW research) — same three-view left / front /
 * right scan, same insistence on brevity and on describing visible surroundings. Two deliberate differences:
 *
 *  * it calls the Generative Language REST endpoint with a plain API key instead of the Firebase SDK, so the app
 *    needs no Firebase project and no extra dependency — just a key in the conf file;
 *  * the answer is capped harder (25 words), because here it is spoken over traffic noise to someone who may be
 *    standing at a curb, and a paragraph is worse than useless.
 *
 * This describes surroundings. It never says whether it is safe to cross — that judgement stays with the traveler.
 */
export async function describeSurroundings(views: CapturedView[], apiKey: string, model = MODEL): Promise<string> {
  if (apiKey.trim().length === 0) throw new Error('No Gemini API key set');
  if (views.length === 0) throw new Error('No views captured');

  const parts: unknown[] = [{ text: prompt(views.map((v) => v.direction)) }];
  for (const v of views) {
    parts.push({ text: `View: ${v.direction}` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: v.jpegBase64 } });
  }
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 200 },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Gemini returned ${response.status}: ${text.slice(0, 200)}`);
    return parseAnswer(text);
  } finally {
    clearTimeout(timeout);
  }
}

function parseAnswer(response: string): string {
  const json = JSON.parse(response) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const parts = json.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('No content in response');
  const answer = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
  return answer.length > 0 ? answer : 'View unclear. Hold still and try again.';
}

function prompt(directions: string[]): string {
  const list = directions.join(', ');
  return [
    'You are assisting a blind or low-vision traveler standing still on a footpath, through an iPhone app.',
    `They captured ${directions.length} view(s) of their surroundings, labelled ${list}.`,
    '',
    'Say, in this order:',
    '- what kind of place this appears to be,',
    '- visible obstacles worth knowing about.',
    '',
    'Rules:',
    '- Under 25 words, one or two sentences, plain spoken English.',
    `- Use only these direction words: ${list}.`,
    '- Never say whether it is safe to cross or to walk; describe only what you can see.',
    '- No route instructions, distance or step estimates, traffic-motion claims, lists or markdown.',
    '- If the views are unclear, say so and ask them to stay still and scan again.',
  ].join('\n');
}

/** Base64 of raw bytes (Hermes has btoa but no Buffer). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
