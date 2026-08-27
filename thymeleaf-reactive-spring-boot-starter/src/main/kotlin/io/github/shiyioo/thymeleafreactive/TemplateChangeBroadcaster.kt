package io.github.shiyioo.thymeleafreactive

import org.springframework.context.SmartLifecycle
import org.springframework.stereotype.Component
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds.ENTRY_CREATE
import java.nio.file.StandardWatchEventKinds.ENTRY_DELETE
import java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.function.Consumer

data class TemplateChange(
    val path: String,
    val kind: String,
    val component: String? = null,
    val moduleUrl: String? = null
)

@Component
class TemplateChangeBroadcaster(private val properties: ReactiveProperties) : SmartLifecycle {
    private val listeners = CopyOnWriteArrayList<Consumer<TemplateChange>>()
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "thymeleaf-reactive-template-watch").apply { isDaemon = true }
    }
    private var running = false

    fun subscribe(listener: Consumer<TemplateChange>): AutoCloseable {
        listeners += listener
        return AutoCloseable { listeners -= listener }
    }

    override fun start() {
        if (!properties.developmentMode || running) return
        val directory = resolveTemplateDirectory() ?: return
        running = true
        executor.submit { watch(directory) }
    }

    override fun stop() {
        running = false
        executor.shutdownNow()
    }

    override fun isRunning(): Boolean = running

    private fun resolveTemplateDirectory(): Path? {
        val raw = properties.templatePath.removePrefix("file:")
        val path = Path.of(raw)
        return path.takeIf { Files.isDirectory(it) }
    }

    private fun watch(directory: Path) {
        FileSystems.getDefault().newWatchService().use { service ->
            directory.register(service, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)
            while (running) {
                val key = service.take()
                key.pollEvents().forEach { event ->
                    val changed = event.context() as? Path ?: return@forEach
                    val kind = event.kind().name()
                    val component = changed.fileName.toString()
                        .substringBeforeLast('.')
                        .takeIf { it.isNotBlank() }
                    listeners.forEach { it.accept(TemplateChange(changed.toString(), kind, component)) }
                }
                if (!key.reset()) break
            }
        }
    }
}
