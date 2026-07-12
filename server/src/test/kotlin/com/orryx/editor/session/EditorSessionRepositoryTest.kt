package com.orryx.editor.session

import com.orryx.editor.license.CreateLicenseCommand
import com.orryx.editor.license.InMemoryLicenseRepository
import com.orryx.editor.license.LicenseService
import kotlinx.coroutines.test.runTest
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EditorSessionRepositoryTest {
    private val now = Instant.parse("2025-01-01T00:00:00Z")

    @Test
    fun `stores token hash rotates active session and revokes`() = runTest {
        val licenseRepository = InMemoryLicenseRepository()
        val licenseService = licenseService(licenseRepository)
        val license = licenseService.create(CreateLicenseCommand("owner"))
        val sessions = InMemoryEditorSessionRepository(licenseService)

        val created = sessions.create(command(license.license, license.serverKey, "resume-secret"))
        assertNotEquals("resume-secret", created.resumeTokenHash)
        assertEquals(ResumeTokenHash.sha256("resume-secret"), created.resumeTokenHash)
        assertEquals("workspace-1", created.workspaceId)
        assertEquals("server-1", created.serverId)
        assertEquals("player", created.playerName)
        assertEquals("browser-1", created.browserId)
        assertNotNull(sessions.findByResumeToken("resume-secret", now.plusSeconds(1)))
        assertNull(sessions.findByResumeToken("wrong-secret", now.plusSeconds(1)))

        val rotated = sessions.rotate(
            resumeToken = "resume-secret",
            replacementToken = "replacement-secret",
            now = now.plusSeconds(2),
            expiresAt = now.plusSeconds(3600)
        )
        assertNotNull(rotated)
        assertEquals(ResumeTokenHash.sha256("replacement-secret"), rotated.resumeTokenHash)
        assertNull(sessions.findByResumeToken("resume-secret", now.plusSeconds(3)))
        assertNotNull(sessions.findByResumeToken("replacement-secret", now.plusSeconds(3)))

        assertTrue(sessions.revoke(created.id, now.plusSeconds(4)))
        assertNull(sessions.findByResumeToken("replacement-secret", now.plusSeconds(5)))
        assertEquals(1, sessions.cleanup(now.plusSeconds(6)))
    }

    @Test
    fun `rejects session creation for ineffective license`() = runTest {
        val licenseRepository = InMemoryLicenseRepository()
        val licenseService = licenseService(licenseRepository)
        val license = licenseService.create(CreateLicenseCommand("owner"))
        licenseService.revoke(license.license)
        val sessions = InMemoryEditorSessionRepository(licenseService)

        kotlin.test.assertFailsWith<IllegalArgumentException> {
            sessions.create(command(license.license, license.serverKey, "resume-secret"))
        }
    }

    private fun command(licenseKey: String, serverKey: String, token: String) = CreateEditorSessionCommand(
        licenseKey = licenseKey,
        workspaceId = "workspace-1",
        serverKey = serverKey,
        serverId = "server-1",
        playerName = "player",
        browserId = "browser-1",
        resumeToken = token,
        now = now,
        ttl = Duration.ofMinutes(30)
    )

    private fun licenseService(repository: InMemoryLicenseRepository) = LicenseService(
        repository = repository,
        clock = Clock.fixed(now, ZoneOffset.UTC),
        licenseKeyGenerator = { "license-key-00000001" },
        serverKeyGenerator = { "server-key-0000000000000000000001" }
    )
}
