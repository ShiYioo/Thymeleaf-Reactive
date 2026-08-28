package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TemplateChangeBroadcasterTest {
    @Test
    fun `maps nested templates and collapses repeated save events`() {
        val properties = ReactiveProperties(
            debounceMillis = 40,
            componentMappings = mapOf("admin/dashboard.html" to "dashboard")
        )
        val broadcaster = TemplateChangeBroadcaster(properties)
        val changes = CopyOnWriteArrayList<TemplateChange>()
        val latch = CountDownLatch(1)
        val subscription = broadcaster.subscribe { change -> changes += change; latch.countDown() }

        broadcaster.notifyChange("admin/dashboard.html", "ENTRY_MODIFY")
        broadcaster.notifyChange("admin/dashboard.html", "ENTRY_MODIFY")
        broadcaster.notifyChange("admin/dashboard.html", "ENTRY_MODIFY")

        assertThat(latch.await(2, TimeUnit.SECONDS)).isTrue()
        Thread.sleep(80)
        assertThat(changes).hasSize(1)
        assertThat(changes.single()).isEqualTo(TemplateChange("admin/dashboard.html", "ENTRY_MODIFY", "dashboard"))
        assertThat(broadcaster.componentFor("pages/profile.html")).isEqualTo("profile")

        subscription.close()
        broadcaster.stop()
    }

    @Test
    fun `ignores non html changes`() {
        val broadcaster = TemplateChangeBroadcaster(ReactiveProperties(debounceMillis = 0))
        val changes = CopyOnWriteArrayList<TemplateChange>()
        val subscription = broadcaster.subscribe { changes += it }
        broadcaster.notifyChange("assets/app.js", "ENTRY_MODIFY")
        Thread.sleep(30)
        assertThat(changes).isEmpty()
        subscription.close()
        broadcaster.stop()
    }
}
