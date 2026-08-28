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
        assertThat(output).contains("data-tr-state=\"{&quot;count&quot;:3,&quot;visible&quot;:true}\"")
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
            """<section tr:if="visible"><span>Hidden</span></section><aside tr:show="visible">Also hidden</aside>""",
            hidden
        )
        assertThat(hiddenOutput).contains("data-tr-if=\"visible\"", "hidden=\"hidden\"", "Hidden")
        assertThat(hiddenOutput).contains("data-tr-show=\"visible\"", "Also hidden")

        val shown = Context().apply { setVariable("visible", true) }
        val shownOutput = engine.process(
            """<section tr:if="visible"><span>Shown</span></section><aside tr:show="visible">Also shown</aside>""",
            shown
        )
        assertThat(shownOutput).contains("data-tr-if=\"visible\"")
        assertThat(shownOutput).contains("Shown")
        assertThat(shownOutput).contains("data-tr-show=\"visible\"", "Also shown")
        assertThat(shownOutput).doesNotContain("hidden=\"hidden\"")
    }

    @Test
    fun `renders dynamic attributes classes and styles on first paint`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("user", mapOf("name" to "Ada"))
            setVariable("classes", mapOf("active" to true, "muted" to false))
            setVariable("styles", mapOf("color" to "red", "display" to "block"))
        }
        val output = engine.process(
            """<a tr:attr="title:user.name,aria-label:user.name" tr:class="classes" tr:style="styles">Link</a>""",
            context
        )
        assertThat(output).contains("data-tr-attr=\"title:user.name,aria-label:user.name\"")
        assertThat(output).contains("title=\"Ada\"")
        assertThat(output).contains("aria-label=\"Ada\"")
        assertThat(output).contains("data-tr-class=\"classes\"")
        assertThat(output).contains("class=\"active\"")
        assertThat(output).contains("data-tr-style=\"styles\"")
        assertThat(output).contains("style=\"color: red; display: block\"")
    }

    @Test
    fun `renders each bindings on the server while retaining client hydration metadata`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("items", listOf(mapOf("id" to "a", "label" to "Alpha"), mapOf("id" to "b", "label" to "Beta")))
        }
        val output = engine.process(
            """<ul><li tr:each="item, stat in items" tr:key="item.id"><span tr:text="item.label">stale</span></li></ul>""",
            context
        )
        assertThat(output).contains("Alpha", "Beta")
        assertThat(output).doesNotContain("stale", "tr:each")
        assertThat(output).contains("data-tr-each=\"item, stat in items\"")
        assertThat(output).contains("data-tr-key-expression=\"item.id\"")
        assertThat(output).contains("data-tr-key=\"a\"", "data-tr-key=\"b\"")
    }
}
