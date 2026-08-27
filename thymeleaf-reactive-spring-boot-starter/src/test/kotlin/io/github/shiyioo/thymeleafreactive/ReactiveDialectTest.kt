package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.thymeleaf.TemplateEngine
import org.thymeleaf.context.Context
import tools.jackson.databind.ObjectMapper

class ReactiveDialectTest {
    @Test
    fun `emits browser metadata and serializes a server model state`() {
        val engine = TemplateEngine().apply { addDialect(ReactiveDialect(ObjectMapper())) }
        val context = Context().apply { setVariable("counter", mapOf("count" to 3, "visible" to true)) }

        val output = engine.process(
            """<section tr:component="counter" tr:state="${'$'}{counter}" tr:key="counter" tr:if="visible"><span tr:text="count">0</span></section>""",
            context
        )

        assertThat(output).contains("data-tr-component=\"counter\"")
        assertThat(output).contains("data-tr-state=\"{\"count\":3,\"visible\":true}\"")
        assertThat(output).contains("data-tr-key=\"counter\"")
        assertThat(output).contains("data-tr-if=\"visible\"")
        assertThat(output).contains("data-tr-text=\"count\"")
    }
}
