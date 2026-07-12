package com.orryx.editor.update

import com.orryx.editor.build.BuildInfo
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class UpdateServiceTest {
    @Test fun `only one update job may be active`() = runBlocking {
        val client = HttpClient(MockEngine { error("network must not be called") })
        val config = UpdateConfig("owner/repo", null, 1024, Path.of("build/test-updates"))
        val scope = CoroutineScope(Job()).also { it.cancel() }
        val service = UpdateService(
            BuildInfo("0.3.0", "launcher", true), config,
            GitHubReleaseClient(client, config), ArtifactDownloader(client, config),
            InMemoryUpdateJobStore(), UpdateJobRunner(scope), { 0 }
        )
        service.start(StartUpdateRequest(UpdateJobAction.CHECK))
        val failure = assertFailsWith<UpdateFailure> { service.start(StartUpdateRequest(UpdateJobAction.CHECK)) }
        assertEquals(UpdateErrorCode.UPDATE_IN_PROGRESS, failure.code)
        client.close()
    }
}
