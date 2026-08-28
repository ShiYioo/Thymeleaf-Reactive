package io.github.shiyioo.thymeleafreactive

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.web.filter.OncePerRequestFilter
import org.springframework.web.util.ContentCachingResponseWrapper
import java.nio.charset.Charset

/** Injects the browser bootstrap into HTML pages during development. */
class ReactiveRuntimeInjectionFilter(
    private val properties: ReactiveProperties
) : OncePerRequestFilter() {
    private val script = "<script type=\"module\" src=\"${properties.runtimePath}\"></script>"

    override fun doFilterInternal(
        request: HttpServletRequest,
        response: HttpServletResponse,
        filterChain: FilterChain
    ) {
        if (!properties.enabled || !properties.developmentMode || request.method == "HEAD") {
            filterChain.doFilter(request, response)
            return
        }
        val wrapper = ContentCachingResponseWrapper(response)
        try {
            filterChain.doFilter(request, wrapper)
            val body = wrapper.contentAsByteArray
            val contentType = wrapper.contentType.orEmpty()
            if (body.isNotEmpty() && contentType.startsWith("text/html", ignoreCase = true)) {
                val charset = runCatching { Charset.forName(wrapper.characterEncoding ?: "UTF-8") }
                    .getOrDefault(Charsets.UTF_8)
                val html = body.toString(charset)
                if (!html.contains("src=\"${properties.runtimePath}\"")) {
                    val index = html.lastIndexOf("</body>", ignoreCase = true)
                    if (index >= 0) {
                        val injected = html.substring(0, index) + script + html.substring(index)
                        wrapper.resetBuffer()
                        wrapper.writer.write(injected)
                    }
                }
            }
        } finally {
            wrapper.copyBodyToResponse()
        }
    }
}
