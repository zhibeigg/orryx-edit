package com.orryx.editor.ketherdocs

import kotlinx.coroutines.test.runTest
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class KetherDocsServiceTest {
    private val config = KetherDocsConfig.fromEnvironment(emptyMap())
    private val validator = KetherDocsValidator(config)

    @Test
    fun `successful sync persists verified cache and survives remote failure`() = runTest {
        val repository = InMemoryKetherDocsRepository()
        val upstream = StubKetherDocsUpstream(Result.success(validFetchedSchema()))
        var now = Instant.parse("2026-03-20T00:00:00Z")
        val service = KetherDocsService(
            config = config,
            repository = repository,
            source = upstream,
            validator = validator,
            bundledLoader = { validator.validateBundled(validSchemaBytes()) },
            clock = { now }
        )

        service.initialize()
        assertEquals(KetherDocsHealth.DEGRADED, service.status().health)
        assertEquals(KetherDocsSource.BUNDLED, service.status().source)

        now = now.plusSeconds(1)
        val synced = service.synchronize()
        assertEquals(KetherDocsHealth.UP_TO_DATE, synced.health)
        assertEquals(KetherDocsSource.REMOTE, synced.source)
        assertEquals(TEST_RELEASE_ID, synced.releaseId)
        assertNotNull(repository.cache)

        upstream.result = Result.failure(KetherDocsFailure(KetherDocsErrorCode.CHANNEL_UNAVAILABLE))
        now = now.plusSeconds(1)
        val degraded = service.synchronize()
        assertEquals(KetherDocsHealth.DEGRADED, degraded.health)
        assertEquals(TEST_RELEASE_ID, degraded.releaseId)
        assertEquals(KetherDocsErrorCode.CHANNEL_UNAVAILABLE, degraded.errorCode)
        assertEquals(validFetchedSchema().schemaSha256, service.currentSchema()?.sha256)

        val restarted = KetherDocsService(
            config = config,
            repository = repository,
            source = upstream,
            validator = validator,
            bundledLoader = { null },
            clock = { now }
        )
        restarted.initialize()
        assertEquals(KetherDocsSource.CACHE, restarted.status().source)
        assertEquals(KetherDocsHealth.DEGRADED, restarted.status().health)
    }

    @Test
    fun `no cache and no bundled schema reports failed without replacing state`() = runTest {
        val repository = InMemoryKetherDocsRepository()
        val service = KetherDocsService(
            config = config,
            repository = repository,
            source = StubKetherDocsUpstream(Result.failure(KetherDocsFailure(KetherDocsErrorCode.CHANNEL_UNAVAILABLE))),
            validator = validator,
            bundledLoader = { null },
            clock = { Instant.parse("2026-03-20T00:00:00Z") }
        )
        service.initialize()
        assertEquals(KetherDocsHealth.FAILED, service.status().health)
        assertEquals(KetherDocsSource.NONE, service.status().source)
        service.synchronize()
        assertEquals(KetherDocsHealth.FAILED, service.status().health)
        assertEquals(KetherDocsErrorCode.CHANNEL_UNAVAILABLE, service.status().errorCode)
    }
}
