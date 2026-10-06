package com.crosswise.voice

data class VoiceCommand(val kind: String, val argument: String = "")
object VoiceCommands {
    const val MANUAL = "After the tone, say navigate to a place. Search only finds places. Say first, second or third to choose. Save as Home saves a place. Repeat, pause, resume, stop navigation. Say manual for commands."
    fun parse(text: String): VoiceCommand? {
        val value = text.trim().trimEnd('.', '!', '?').trim()
        val lower = value.lowercase(java.util.Locale.ROOT)
        val simple = mapOf("manual" to "help", "man" to "help", "help" to "help", "repeat" to "repeat", "pause" to "pause", "resume" to "resume",
            "stop navigation" to "end", "end journey" to "end", "cancel" to "cancel", "retry" to "retry", "start" to "start", "confirm" to "start", "stop listening" to "off", "save" to "save", "save this" to "save", "save location" to "save", "start journey" to "start", "pause navigation" to "pause", "resume navigation" to "resume", "voice help" to "help", "show commands" to "help")
        simple[lower]?.let { return VoiceCommand(it) }
        Regex("^(?:(?:choose|select|number|option) )?(first|second|third|one|two|three|1|2|3)$").matchEntire(lower)?.let {
            val index = when (it.groupValues[1]) { "first", "one", "1" -> 0; "second", "two", "2" -> 1; else -> 2 }
            return VoiceCommand("choose", index.toString())
        }
        Regex("^(navigate to|go to|take me to|search for|search|find) (.+)$", RegexOption.IGNORE_CASE).matchEntire(value)?.let {
            return VoiceCommand(if (it.groupValues[1].lowercase().startsWith("search") || it.groupValues[1].equals("find", true)) "search" else "navigate", it.groupValues[2])
        }
        Regex("^save(?: this)? as (.+)$", RegexOption.IGNORE_CASE).matchEntire(value)?.let { return VoiceCommand("save", it.groupValues[1]) }
        return null
    }
}
