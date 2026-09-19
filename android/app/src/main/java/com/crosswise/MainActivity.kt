package com.crosswise

import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import com.crosswise.ui.CrossWiseApp
import com.crosswise.ui.CrossWiseTheme
import com.crosswise.ui.CrossWiseViewModel

class MainActivity : ComponentActivity() {
    private val viewModel: CrossWiseViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CrossWiseTheme {
                CrossWiseApp(viewModel)
            }
        }
    }

    /** Hands-free control: works with the phone in a chest mount or pocket-less lanyard. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        viewModel.handleVolumeKey(keyCode, event.repeatCount) || super.onKeyDown(keyCode, event)
}
