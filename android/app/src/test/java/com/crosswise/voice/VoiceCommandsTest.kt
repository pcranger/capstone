package com.crosswise.voice
import org.junit.Assert.*
import org.junit.Test
class VoiceCommandsTest {
    @Test fun manualAliases() { for (word in listOf("manual", "MAN", "Manual?")) assertEquals("help", VoiceCommands.parse(word)?.kind) }
    @Test fun rejectsAmbientSpeechAndRemovedPhrase() { for (word in listOf("what can I say", "Held", "And journey", "Sydney Town Hall", "cross now", "yes")) assertNull(VoiceCommands.parse(word)) }
    @Test fun searchDoesNotNavigate() { assertEquals(VoiceCommand("search", "a library"), VoiceCommands.parse("Search for a library")); assertEquals(VoiceCommand("navigate", "Home"), VoiceCommands.parse("Navigate to Home")) }
    @Test fun aliasesAndChoice() { assertEquals(VoiceCommand("save", "Home"), VoiceCommands.parse("save as Home")); assertEquals(VoiceCommand("choose", "1"), VoiceCommands.parse("second")); assertEquals("end", VoiceCommands.parse("stop navigation")?.kind) }
    @Test fun userModeDisablesAutomaticCrossing() { assertFalse(com.crosswise.settings.AppSettings().engineSettings().autoDetectCrossing); assertTrue(com.crosswise.settings.AppSettings(interfaceMode = com.crosswise.settings.InterfaceMode.DEVELOPER).engineSettings().autoDetectCrossing) }
}
