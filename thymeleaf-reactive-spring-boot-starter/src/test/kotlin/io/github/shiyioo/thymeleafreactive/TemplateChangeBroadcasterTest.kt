package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.io.path.createTempFile
import kotlin.io.path.createTempDirectory
import kotlin.io.path.writeText

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

    @Test
    fun `discovers the declared component from a changed template`() {
        val source = createTempFile(suffix = ".html").apply {
            writeText("<main tr:component=\"counter\"><p>Counter</p></main>")
        }
        val broadcaster = TemplateChangeBroadcaster(ReactiveProperties())
        assertThat(broadcaster.componentFor("index.html", source)).isEqualTo("counter")
        source.toFile().delete()
        broadcaster.stop()
    }

    @Test
    fun `watches a real template directory and broadcasts filesystem changes`() {
        val directory = createTempDirectory("thymeleaf-reactive-watch")
        val broadcaster = TemplateChangeBroadcaster(
            ReactiveProperties(templatePath = "file:${directory.toAbsolutePath()}", debounceMillis = 20)
        )
        val template = directory.resolve("counter.html").apply {
            writeText("<main tr:component=\"counter\">Before</main>")
        }
        val latch = CountDownLatch(1)
        val changes = CopyOnWriteArrayList<TemplateChange>()
        val subscription = broadcaster.subscribe { change -> changes += change; latch.countDown() }
        broadcaster.start()
        template.writeText("<main tr:component=\"counter\">Updated</main>")

        assertThat(latch.await(3, TimeUnit.SECONDS)).isTrue()
        assertThat(changes.single().path).isEqualTo("counter.html")
        assertThat(changes.single().component).isEqualTo("counter")
        subscription.close()
        broadcaster.stop()
        directory.toFile().deleteRecursively()
    }
}
