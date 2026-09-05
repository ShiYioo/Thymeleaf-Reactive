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
    fun `renders common reactive expressions on the first paint`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply { setVariable("count", 2) }
        val output = engine.process(
            """<section><strong tr:text="count + 1">stale</strong><p tr:if="count > 0">Visible</p><a tr:attr="title:count > 1 ? 'many' : 'one'">Link</a></section>""",
            context
        )
        assertThat(output).contains(">3</strong>", "Visible", "title=\"many\"")
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

    @Test
    fun `serializes independent component props metadata`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("counter", mapOf("count" to 3))
            setVariable("props", mapOf("label" to "A&B", "enabled" to true))
        }

        val output = engine.process(
            """<section tr:component="counter" tr:state="${'$'}{counter}" tr:props="${'$'}{props}"></section>""",
            context
        )

        assertThat(output).contains("data-tr-state=\"{&quot;count&quot;:3}\"")
        assertThat(output).contains("data-tr-props=\"{&quot;label&quot;:&quot;A&amp;B&quot;,&quot;enabled&quot;:true}\"")
    }

    @Test
    fun `renders of syntax on the server`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("items", listOf("Alpha", "Beta"))
        }
        val output = engine.process(
            """<ul><li tr:each="item of items" tr:text="item">stale</li></ul>""",
            context
        )
        assertThat(output).contains(">Alpha<", ">Beta<", "data-tr-each=\"item of items\"")
        assertThat(output).doesNotContain("stale", "tr:each")
    }

    @Test
    fun `renders numeric each ranges on the server`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val output = engine.process(
            """<ol><li tr:each="n in 3" tr:text="n">stale</li></ol>""",
            Context()
        )
        assertThat(output).contains(">1<", ">2<", ">3<", "data-tr-each=\"n in 3\"")
        assertThat(output).doesNotContain("stale", "tr:each")
    }

    @Test
    fun `uses reactive truthiness for if and show`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("name", "Alpha")
            setVariable("empty", "")
            setVariable("count", 1)
        }
        val output = engine.process(
            """<p tr:if="name">Name</p><p tr:if="empty">Empty</p><p tr:if="count">Count</p><aside tr:show="name">Shown</aside>""",
            context
        )
        assertThat(output).contains("Name", "Count", "Shown")
        assertThat(output).contains("data-tr-if=\"empty\"", "hidden=\"hidden\"")
    }

    @Test
    fun `matches client truthiness for dynamic class and style maps`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply {
            setVariable("classes", mapOf("active" to "yes", "muted" to ""))
            setVariable("styles", mapOf("color" to "red", "display" to null))
        }
        val output = engine.process(
            """<div tr:class="classes" tr:style="styles">Content</div>""",
            context
        )
        assertThat(output).contains("class=\"active\"", "style=\"color: red\"")
        assertThat(output).doesNotContain("muted", "display: null")
    }

    @Test
    fun `renders reactive html content on the server`() {
        val engine = TemplateEngine().apply {
            setTemplateResolver(StringTemplateResolver())
            addDialect(ReactiveDialect(ObjectMapper()))
        }
        val context = Context().apply { setVariable("content", "<strong>Ready</strong>") }
        val output = engine.process(
            """<section tr:html="content">stale</section>""",
            context
        )
        assertThat(output).contains("data-tr-html=\"content\"", "<strong>Ready</strong>")
        assertThat(output).doesNotContain("stale", "tr:html")
    }
}
