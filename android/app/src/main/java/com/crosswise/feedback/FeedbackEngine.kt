package com.crosswise.feedback

import android.content.Context

data class FeedbackConfig(
    val speech: Boolean = true,
    val tones: Boolean = true,
    val haptics: Boolean = true,
    val speechRate: Float = 1.0f,
)

/** Plays engine cues through speech, tones and vibration according to the user's preferences. */
class FeedbackEngine(context: Context) {
    private val appContext = context.applicationContext
    private val speaker = Speaker(appContext)
    private val tones = TonePlayer()
    private val haptics = Haptics(appContext)

    @Volatile
    var config: FeedbackConfig = FeedbackConfig()
        set(value) {
            field = value
            speaker.speechRate = value.speechRate
        }

    /** Text of a phrase, also used for on-screen captions and logs. */
    fun textOf(cue: Cue.Speak): String {
        val args = cue.args.toTypedArray()
        return when (val res = cue.phrase.resource()) {
            is PhraseResource.Text -> appContext.getString(res.id, *args)
            is PhraseResource.Plural ->
                appContext.resources.getQuantityString(res.id, (cue.args.firstOrNull() as? Int) ?: 0, *args)
        }
    }

    fun dispatch(cues: List<Cue>) {
        if (cues.isEmpty()) return
        val cfg = config
        var interruptUsed = false
        for (cue in cues) {
            when (cue) {
                is Cue.Speak -> if (cfg.speech) {
                    // Within one batch only the first urgent message may interrupt; the rest queue behind it.
                    val interrupt = !interruptUsed && cue.priority >= Priority.HIGH
                    if (cue.priority >= Priority.HIGH) interruptUsed = true
                    speaker.speak(textOf(cue), cue.priority, interrupt)
                }
                is Cue.Tone -> if (cfg.tones) tones.play(cue.kind, cue.pan)
                is Cue.Haptic -> if (cfg.haptics) haptics.play(cue.pattern)
            }
        }
    }

    fun silence() {
        speaker.stop()
        haptics.cancel()
    }

    fun release() {
        speaker.release()
        tones.release()
        haptics.cancel()
    }
}
