package io.github.shiyioo.thymeleafreactive

import org.springframework.context.SmartLifecycle
import org.springframework.core.io.ClassPathResource
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardWatchEventKinds.ENTRY_CREATE
import java.nio.file.StandardWatchEventKinds.ENTRY_DELETE
import java.nio.file.StandardWatchEventKinds.ENTRY_MODIFY
import java.nio.file.WatchKey
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.function.Consumer

data class TemplateChange(
    val path: String,
    val kind: String,
    val component: String? = null,
    val moduleUrl: String? = null
)

class TemplateChangeBroadcaster(private val properties: ReactiveProperties) : SmartLifecycle {
    private val listeners = CopyOnWriteArrayList<Consumer<TemplateChange>>()
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "thymeleaf-reactive-template-watch").apply { isDaemon = true }
    }
    private val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "thymeleaf-reactive-template-debounce").apply { isDaemon = true }
    }
    private val pending = mutableMapOf<String, ScheduledFuture<*>>()
    private val pendingLock = Any()
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
        scheduler.shutdownNow()
        synchronized(pendingLock) {
            pending.values.forEach { it.cancel(false) }
            pending.clear()
        }
    }

    override fun isRunning(): Boolean = running

    /** Schedules one normalized event; repeated saves of the same template collapse into one event. */
    internal fun notifyChange(relativePath: String, kind: String) {
        if (!relativePath.endsWith(".html", ignoreCase = true)) return
        val normalized = relativePath.replace('\\', '/')
        val delay = properties.debounceMillis.coerceAtLeast(0)
        synchronized(pendingLock) {
            pending.remove(normalized)?.cancel(false)
            pending[normalized] = scheduler.schedule({
                val change = TemplateChange(normalized, kind, componentFor(normalized))
                listeners.forEach { it.accept(change) }
                synchronized(pendingLock) { pending.remove(normalized) }
            }, delay, TimeUnit.MILLISECONDS)
        }
    }

    internal fun componentFor(relativePath: String): String? {
        val normalized = relativePath.replace('\\', '/')
        properties.componentMappings[normalized]?.let { return it }
        return Path.of(normalized).fileName.toString()
            .substringBeforeLast('.')
            .takeIf { it.isNotBlank() }
    }

    private fun resolveTemplateDirectory(): Path? {
        if (properties.templatePath.startsWith("classpath:")) {
            val resource = ClassPathResource(properties.templatePath.removePrefix("classpath:"))
            return runCatching { resource.file.toPath() }.getOrNull()?.takeIf { Files.isDirectory(it) }
        }
        val path = Path.of(properties.templatePath.removePrefix("file:"))
        return path.takeIf { Files.isDirectory(it) }
    }

    private fun watch(directory: Path) {
        FileSystems.getDefault().newWatchService().use { service ->
            val watchedDirectories = mutableMapOf<WatchKey, Path>()
            Files.walk(directory).use { paths ->
                paths.filter { Files.isDirectory(it) }.forEach { path ->
                    watchedDirectories[path.register(service, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)] = path
                }
            }
            while (running) {
                val key = service.take()
                val parent = watchedDirectories[key] ?: continue
                key.pollEvents().forEach { event ->
                    val changed = event.context() as? Path ?: return@forEach
                    val absolutePath = parent.resolve(changed)
                    if (event.kind() == ENTRY_CREATE && Files.isDirectory(absolutePath)) {
                        watchedDirectories[absolutePath.register(service, ENTRY_CREATE, ENTRY_MODIFY, ENTRY_DELETE)] = absolutePath
                    }
                    val relativePath = directory.relativize(absolutePath).toString().replace('\\', '/')
                    notifyChange(relativePath, event.kind().name())
                }
                if (!key.reset()) watchedDirectories.remove(key)
            }
        }
    }
}
