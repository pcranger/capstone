package com.crosswise.ai

import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * "Describe what is around me": sends a few camera views to Gemini and returns one short spoken answer.
 *
 * The prompt is adapted from `GeminiVlmService` in the AN-S3 project (UOW research) — same three-view left / front /
 * right scan, same insistence on brevity and on naming a safer direction. Two deliberate differences:
 *
 *  * it calls the Generative Language REST endpoint with a plain API key instead of the Firebase SDK, so the app
 *    needs no Firebase project, no google-services.json and no extra dependency — just a key in the conf file;
 *  * the answer is capped harder (40 words), because here it is spoken over traffic noise to someone who may be
 *    standing at a curb, and a paragraph is worse than useless.
 *
 * This describes surroundings. It never says whether it is safe to cross — that judgement stays with the traveler.
 */
class GeminiService {

    suspend fun describeSurroundings(views: List<Pair<String, Bitmap>>, apiKey: String, model: String = MODEL): Result<String> =
        withContext(Dispatchers.IO) {
            if (apiKey.isBlank()) {
                return@withContext Result.failure(IllegalStateException("No Gemini API key set"))
            }
            if (views.isEmpty()) {
                return@withContext Result.failure(IllegalStateException("No views captured"))
            }
            runCatching {
                val parts = JSONArray().put(JSONObject().put("text", prompt(views.map { it.first })))
                views.forEach { (direction, bitmap) ->
                    parts.put(JSONObject().put("text", "View: $direction"))
                    parts.put(
                        JSONObject().put(
                            "inline_data",
                            JSONObject()
                                .put("mime_type", "image/jpeg")
                                .put("data", bitmap.toBase64Jpeg()),
                        ),
                    )
                }
                val body = JSONObject()
                    .put("contents", JSONArray().put(JSONObject().put("role", "user").put("parts", parts)))
                    .put(
                        "generationConfig",
                        JSONObject().put("temperature", 0.2).put("maxOutputTokens", 200),
                    )

                val url = URL("$ENDPOINT/$model:generateContent")
                val connection = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    doOutput = true
                    connectTimeout = 15_000
                    readTimeout = 30_000
                    setRequestProperty("Content-Type", "application/json")
                    setRequestProperty("x-goog-api-key", apiKey)
                }
                connection.outputStream.use { it.write(body.toString().toByteArray()) }
                val code = connection.responseCode
                val text = (if (code in 200..299) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { it.readText() }.orEmpty()
                connection.disconnect()
                if (code !in 200..299) error("Gemini returned $code: ${text.take(200)}")
                parseAnswer(text)
            }.onFailure { Log.w(TAG, "describeSurroundings failed", it) }
        }

    private fun parseAnswer(response: String): String {
        val candidates = JSONObject(response).optJSONArray("candidates") ?: error("No candidates in response")
        val parts = candidates.optJSONObject(0)?.optJSONObject("content")?.optJSONArray("parts")
            ?: error("No content in response")
        val answer = buildString {
            for (i in 0 until parts.length()) append(parts.optJSONObject(i)?.optString("text").orEmpty())
        }.trim()
        return answer.ifBlank { "I could not see the surroundings clearly. Stay still and try again." }
    }

    private fun Bitmap.toBase64Jpeg(): String {
        // 768 px is plenty for scene description and keeps the upload small on a phone at a curb.
        val scale = MAX_SIDE.toFloat() / maxOf(width, height)
        val source = if (scale >= 1f) this else Bitmap.createScaledBitmap(
            this, (width * scale).toInt(), (height * scale).toInt(), true,
        )
        val stream = ByteArrayOutputStream()
        source.compress(Bitmap.CompressFormat.JPEG, 80, stream)
        if (source !== this) source.recycle()
        return Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
    }

    private fun prompt(directions: List<String>): String = """
        You are assisting a blind or low-vision traveler standing still on a footpath, through an Android app.
        They captured ${directions.size} view(s) of their surroundings, labelled ${directions.joinToString(", ")}.

        Say, in this order:
        - what kind of place this appears to be,
        - the nearest obstacle or risk worth knowing about,
        - which of the given directions looks more open.

        Rules:
        - Under 40 words, one or two sentences, plain spoken English.
        - Use only these direction words: ${directions.joinToString(", ")}.
        - Never say whether it is safe to cross or to walk; describe only what you can see.
        - No route instructions, no lists, no markdown.
        - If the views are unclear, say so and ask them to stay still and scan again.
    """.trimIndent()

    companion object {
        private const val TAG = "GeminiService"
        private const val ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
        private const val MODEL = "gemini-2.5-flash"
        private const val MAX_SIDE = 768
    }
}
