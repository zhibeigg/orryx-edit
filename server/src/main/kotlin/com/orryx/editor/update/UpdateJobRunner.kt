package com.orryx.editor.update

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class UpdateJobRunner(private val scope: CoroutineScope) {
    fun submit(block: suspend () -> Unit) {
        scope.launch { block() }
    }
}
