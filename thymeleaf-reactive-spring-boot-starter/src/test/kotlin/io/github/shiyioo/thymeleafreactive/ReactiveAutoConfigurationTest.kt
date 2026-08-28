package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test

class ReactiveAutoConfigurationTest {
    @Test
    fun `configures a highest priority file resolver for development templates`() {
        val resolver = ReactiveAutoConfiguration().reactiveFileTemplateResolver(
            ReactiveProperties(templatePath = "file:src/main/resources/templates", developmentMode = true)
        )
        assertThat(resolver.prefix).isEqualTo("file:src/main/resources/templates/")
        assertThat(resolver.suffix).isEqualTo(".html")
        assertThat(resolver.order).isZero()
        assertThat(resolver.isCacheable).isFalse()
        assertThat(resolver.checkExistence).isTrue()
    }
}
