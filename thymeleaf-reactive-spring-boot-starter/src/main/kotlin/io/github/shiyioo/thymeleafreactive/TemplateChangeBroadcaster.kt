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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ConcurrentHashMap
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
    private val templateStamps = ConcurrentHashMap<Path, Pair<Long, Long>>()
    @Volatile private var watcherReady = CountDownLatch(0)
    @Volatile private var watchedDirectory: Path? = null
    @Volatile private var pollTask: ScheduledFuture<*>? = null
    private var running = false

    fun subscribe(listener: Consumer<TemplateChange>): AutoCloseable {
        listeners += listener
        return AutoCloseable { listeners -= listener }
    }

    override fun start() {
        if (!properties.developmentMode || running) return
        val directory = resolveTemplateDirectory() ?: return
        watchedDirectory = directory.toAbsolutePath().normalize()
        snapshotTemplates(directory)
        running = true
        watcherReady = CountDownLatch(1)
        executor.submit {
            try {
                watch(directory)
            } finally {
                running = false
                watcherReady.countDown()
            }
        }
        watcherReady.await(2, TimeUnit.SECONDS)
        val pollInterval = properties.pollIntervalMillis.coerceAtLeast(50)
        pollTask = scheduler.scheduleWithFixedDelay(
            { pollTemplates(directory) }, pollInterval, pollInterval, TimeUnit.MILLISECONDS
        )
    }

    override fun stop() {
        running = false
        executor.shutdownNow()
        scheduler.shutdownNow()
        pollTask?.cancel(false)
        pollTask = null
        synchronized(pendingLock) {
            pending.values.forEach { it.cancel(false) }
            pending.clear()
        }
        watchedDirectory = null
    }

    override fun isRunning(): Boolean = running

    fun status(): Map<String, Any?> = mapOf(
        "running" to running,
        "directory" to watchedDirectory?.toString(),
        "templatePath" to properties.templatePath
    )

    /** Schedules one normalized event; repeated saves of the same template collapse into one event. */
    internal fun notifyChange(relativePath: String, kind: String, source: Path? = null) {
        if (!relativePath.endsWith(".html", ignoreCase = true)) return
        val normalized = relativePath.replace('\\', '/')
        source?.let { rememberTemplate(it) }
        val delay = properties.debounceMillis.coerceAtLeast(0)
        synchronized(pendingLock) {
            pending.remove(normalized)?.cancel(false)
            pending[normalized] = scheduler.schedule({
                val change = TemplateChange(normalized, kind, componentFor(normalized, source))
                listeners.forEach { it.accept(change) }
                synchronized(pendingLock) { pending.remove(normalized) }
            }, delay, TimeUnit.MILLISECONDS)
        }
    }

    internal fun componentFor(relativePath: String, source: Path? = null): String? {
        val normalized = relativePath.replace('\\', '/')
        properties.componentMappings[normalized]?.let { return it }
        source?.takeIf { Files.isRegularFile(it) }?.let { template ->
            runCatching { Files.readString(template) }.getOrNull()
                ?.let { content -> Regex("""(?:tr:component|data-tr-component)\s*=\s*["']([^"']+)["']""")
                    .find(content)?.groupValues?.getOrNull(1) }
                ?.let { return it }
        }
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
            watcherReady.countDown()
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
                    notifyChange(relativePath, event.kind().name(), absolutePath)
                }
                if (!key.reset()) watchedDirectories.remove(key)
            }
        }
    }

    private fun snapshotTemplates(directory: Path) {
        templateStamps.clear()
        Files.walk(directory).use { paths ->
            paths.filter { Files.isRegularFile(it) && it.toString().endsWith(".html", ignoreCase = true) }
                .forEach(::rememberTemplate)
        }
    }

    private fun rememberTemplate(path: Path) {
        if (!Files.isRegularFile(path)) {
            templateStamps.remove(path.toAbsolutePath().normalize())
            return
        }
        templateStamps[path.toAbsolutePath().normalize()] = Files.getLastModifiedTime(path).toMillis() to Files.size(path)
    }

    private fun pollTemplates(directory: Path) {
        if (!running) return
        val current = mutableSetOf<Path>()
        Files.walk(directory).use { paths ->
            paths.filter { Files.isRegularFile(it) && it.toString().endsWith(".html", ignoreCase = true) }.forEach { path ->
                val normalized = path.toAbsolutePath().normalize()
                current.add(normalized)
                val stamp = Files.getLastModifiedTime(path).toMillis() to Files.size(path)
                if (templateStamps.put(normalized, stamp) != stamp) {
                    notifyChange(directory.relativize(path).toString(), "POLL_MODIFY", path)
                }
            }
        }
        templateStamps.keys.filter { it !in current }.forEach { removed ->
            templateStamps.remove(removed)
            notifyChange(directory.toAbsolutePath().normalize().relativize(removed).toString(), "POLL_DELETE", removed)
        }
    }
}
