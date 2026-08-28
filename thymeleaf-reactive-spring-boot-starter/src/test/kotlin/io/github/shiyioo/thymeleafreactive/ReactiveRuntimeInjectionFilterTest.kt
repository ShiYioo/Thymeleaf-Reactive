package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.mock.web.MockHttpServletResponse
import jakarta.servlet.FilterChain
import jakarta.servlet.ServletRequest
import jakarta.servlet.ServletResponse

private fun chain(write: (ServletResponse) -> Unit): FilterChain = FilterChain { _, response -> write(response) }

class ReactiveRuntimeInjectionFilterTest {
    @Test
    fun `injects bootstrap before closing body for development html responses`() {
        val filter = ReactiveRuntimeInjectionFilter(ReactiveProperties())
        val request = MockHttpServletRequest("GET", "/")
        val response = MockHttpServletResponse()
        response.contentType = "text/html;charset=UTF-8"
        val filterChain = chain { response -> response.writer.write("<html><body><h1>Hello</h1></body></html>") }

        filter.doFilter(request, response, filterChain)

        val body = response.contentAsString
        assertThat(body).contains("<script type=\"module\" src=\"/__thymeleaf_reactive__/bootstrap.js\"></script></body>")
        assertThat(body.indexOf("<script")).isLessThan(body.indexOf("</body>"))
    }

    @Test
    fun `does not inject non html responses or duplicate bootstrap`() {
        val filter = ReactiveRuntimeInjectionFilter(ReactiveProperties())
        val request = MockHttpServletRequest("GET", "/data")
        val response = MockHttpServletResponse()
        response.contentType = "application/json"
        filter.doFilter(request, response, chain { it.writer.write("{\"ok\":true}") })
        assertThat(response.contentAsString).isEqualTo("{\"ok\":true}")

        val htmlRequest = MockHttpServletRequest("GET", "/")
        val htmlResponse = MockHttpServletResponse()
        htmlResponse.contentType = "text/html"
        val existing = "<html><body><script type=\"module\" src=\"/__thymeleaf_reactive__/bootstrap.js\"></script></body></html>"
        filter.doFilter(htmlRequest, htmlResponse, chain { it.writer.write(existing) })
        assertThat(htmlResponse.contentAsString).isEqualTo(existing)
    }
}
