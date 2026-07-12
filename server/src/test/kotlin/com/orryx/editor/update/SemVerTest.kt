package com.orryx.editor.update

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SemVerTest {
    @Test fun `only three-part semantic versions are accepted`() {
        assertEquals(SemVer(0, 3, 1), SemVer.parse("0.3.1"))
        assertEquals(SemVer(0, 3, 1), SemVer.parse("v0.3.1"))
        assertNull(SemVer.parse("0.3"))
        assertNull(SemVer.parse("0.3.1-beta.1"))
        assertNull(SemVer.parse("01.3.1"))
        assertTrue(SemVer.parse("0.3.2")!! > SemVer.parse("0.3.1")!!)
    }
}
