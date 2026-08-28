package io.github.shiyioo.thymeleafreactive

import org.assertj.core.api.Assertions.assertThat
import org.junit.jupiter.api.Test
import org.thymeleaf.TemplateEngine
import org.thymeleaf.context.Context
import org.thymeleaf.templateresolver.StringTemplateResolver
import tools.jackson.databind.ObjectMapper

class ReactiveDialectTest {
    @Test
    fun `emits browser metadata and serializes a server model state`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
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
        assertThat(output).contains(">3</span>")
    }

    @Test
    fun `applies server side conditional semantics while retaining reactive metadata`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val hidden = Context().apply { setVariable("visible", false) }
        val hiddenOutput = engine.process(
            """<section tr:if="visible"><span>Hidden</span></section>""",
            hidden
        )
        assertThat(hiddenOutput).doesNotContain("Hidden")

        val shown = Context().apply { setVariable("visible", true) }
        val shownOutput = engine.process(
            """<section tr:if="visible"><span>Shown</span></section>""",
            shown
        )
        assertThat(shownOutput).contains("data-tr-if=\"visible\"")
        assertThat(shownOutput).contains("Shown")
    }
}
