package com.crosswise

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.crosswise.ui.CrossWiseApp
import com.crosswise.ui.CrossWiseTheme
import com.crosswise.ui.CrossWiseViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: CrossWiseViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            // The typeface is a user setting, so the theme has to follow it live.
            val settings by viewModel.settings.collectAsStateWithLifecycle()
            CrossWiseTheme(font = settings.appFont) {
                CrossWiseApp(viewModel)
            }
        }
    }

}
