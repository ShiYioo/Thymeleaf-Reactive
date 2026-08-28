package io.github.shiyioo.thymeleafreactive

import org.springframework.http.CacheControl
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import org.springframework.core.io.ClassPathResource
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path

/** Serves a resource-backed Vue SFC as a cache-busted browser ES module in development. */
@RestController
@RequestMapping("/__thymeleaf_reactive__")
class VueComponentController(
    private val properties: ReactiveProperties,
    private val objectMapper: ObjectMapper
) {
    @GetMapping("/component", produces = ["text/javascript"])
    fun component(@RequestParam path: String): ResponseEntity<String> {
        val source = resolveSource(path) ?: return ResponseEntity.notFound().build()
        val module = "import { compileSfcComponent } from '/thymeleaf-reactive/index.js';\n" +
            "export default compileSfcComponent(${objectMapper.writeValueAsString(Files.readString(source))});\n"
        return ResponseEntity.ok()
            .contentType(MediaType.valueOf("text/javascript"))
            .cacheControl(CacheControl.noStore())
            .body(module)
    }

    private fun resolveSource(requestedPath: String): Path? {
        if (!properties.developmentMode || !requestedPath.endsWith(".vue", ignoreCase = true)) return null
        val relative = Path.of(requestedPath).normalize()
        if (relative.isAbsolute || relative.startsWith("..")) return null
        val root = if (properties.templatePath.startsWith("classpath:")) {
            runCatching {
                ClassPathResource(properties.templatePath.removePrefix("classpath:")).file.toPath()
                    .toAbsolutePath().normalize()
            }.getOrNull()
        } else {
            runCatching { Path.of(properties.templatePath.removePrefix("file:")).toAbsolutePath().normalize() }.getOrNull()
        } ?: return null
        val candidate = root.resolve(relative).normalize()
        return candidate.takeIf { it.startsWith(root) && Files.isRegularFile(it) }
    }
}
