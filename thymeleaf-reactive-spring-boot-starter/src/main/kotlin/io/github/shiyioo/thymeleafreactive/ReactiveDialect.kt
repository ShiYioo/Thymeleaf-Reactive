package io.github.shiyioo.thymeleafreactive

import tools.jackson.databind.ObjectMapper
import org.thymeleaf.dialect.AbstractProcessorDialect
import org.thymeleaf.processor.IProcessor
import org.thymeleaf.templatemode.TemplateMode
import org.thymeleaf.processor.element.AbstractAttributeTagProcessor
import org.thymeleaf.processor.element.IElementTagStructureHandler
import org.thymeleaf.context.ITemplateContext
import org.thymeleaf.model.IProcessableElementTag
import org.thymeleaf.engine.AttributeName
import org.thymeleaf.standard.expression.StandardExpressions

class ReactiveDialect(private val objectMapper: ObjectMapper) : AbstractProcessorDialect("Thymeleaf Reactive", "tr", 1000) {
    override fun getProcessors(dialectPrefix: String): Set<IProcessor> = setOf(
        ReactiveAttributeProcessor("component", "data-tr-component"),
        ReactiveKeyProcessor(),
        ReactiveEachProcessor(),
        ReactiveStateProcessor(objectMapper),
        ReactiveTextProcessor(),
        ReactiveAttributeProcessor("model", "data-tr-model"),
        ReactiveIfProcessor(),
        ReactiveShowProcessor(),
        ReactiveAttributeProcessor("on", "data-tr-on"),
        ReactiveDynamicProcessor("attr", "data-tr-attr"),
        ReactiveDynamicProcessor("class", "data-tr-class"),
        ReactiveDynamicProcessor("style", "data-tr-style")
    )
}

private class ReactiveEachProcessor : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, "each", true, 900, true
) {
    private val syntax = Regex("^\\s*([A-Za-z_$][\\w$]*)(?:\\s*,\\s*([A-Za-z_$][\\w$]*))?\\s+in\\s+(.+?)\\s*$")

    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        val match = syntax.matchEntire(attributeValue) ?: return
        val variable = match.groupValues[1]
        val status = match.groupValues[2].ifBlank { null }
        val collection = evaluate(context, match.groupValues[3]) ?: emptyList<Any>()
        structureHandler.setAttribute("data-tr-each", attributeValue)
        structureHandler.removeAttribute(attributeName)
        structureHandler.iterateElement(variable, status, collection)
    }
}

private class ReactiveKeyProcessor : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, "key", true, 1000, true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        val shouldEvaluate = attributeValue.contains('.') || attributeValue.trim().startsWith("${'$'}{")
        val key = if (shouldEvaluate) evaluate(context, attributeValue) ?: attributeValue else attributeValue
        structureHandler.setAttribute("data-tr-key", key.toString())
        structureHandler.setAttribute("data-tr-key-expression", attributeValue)
    }
}

private fun evaluate(context: ITemplateContext, expression: String): Any? {
    val normalized = expression.trim()
    if (!normalized.startsWith("${'$'}{")) {
        val keys = normalized.split('.').filter(String::isNotBlank)
        fun descend(root: Any?): Any? = keys.drop(1).fold(root) { current, key ->
            when (current) {
                is Map<*, *> -> current[key]
                else -> current?.javaClass?.methods?.firstOrNull { method ->
                    method.parameterCount == 0 && (method.name == key || method.name == "get${key.replaceFirstChar(Char::uppercase)}")
                }?.invoke(current)
            }
        }
        context.getVariable(keys.first())?.let { return descend(it) }
        // Allow a component state map (for example `counter`) to expose
        // convenient bare bindings such as `count` and `visible`.
        for (name in context.variableNames) {
            val candidate = context.getVariable(name)
            val value = when (candidate) {
                is Map<*, *> -> candidate[keys.first()]
                else -> candidate?.javaClass?.methods?.firstOrNull { method ->
                    method.parameterCount == 0 && (method.name == keys.first() || method.name == "get${keys.first().replaceFirstChar(Char::uppercase)}")
                }?.invoke(candidate)
            }
            if (value != null) return descend(value)
        }
        return null
    }
    return runCatching {
        StandardExpressions.getExpressionParser(context.configuration)
            .parseExpression(context, normalized)
            .execute(context)
    }.getOrNull()
}

private class ReactiveTextProcessor : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, "text", true, 1000, true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        structureHandler.setAttribute("data-tr-text", attributeValue)
        structureHandler.setBody((evaluate(context, attributeValue) ?: "").toString(), false)
    }
}

private class ReactiveIfProcessor : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, "if", true, 1000, true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        structureHandler.setAttribute("data-tr-if", attributeValue)
        if (evaluate(context, attributeValue) != true) structureHandler.setAttribute("hidden", "hidden")
    }
}

private class ReactiveShowProcessor : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, "show", true, 1000, true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        structureHandler.setAttribute("data-tr-show", attributeValue)
        if (evaluate(context, attributeValue) != true) structureHandler.setAttribute("hidden", "hidden")
    }
}

private class ReactiveStateProcessor(private val objectMapper: ObjectMapper) : AbstractAttributeTagProcessor(
    TemplateMode.HTML,
    "tr",
    null,
    false,
    "state",
    true,
    1000,
    true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        val expression = attributeValue.trim()
        val isModelReference = expression.startsWith("\${") && expression.endsWith('}')
        val state = if (isModelReference) context.getVariable(expression.substring(2, expression.length - 1).trim()) else null
        val json = if (isModelReference) objectMapper.writeValueAsString(state) else attributeValue
        // Attribute processors write literal values, so quote and ampersand
        // entities must be supplied explicitly for valid HTML output.
        val attributeJson = json.replace("&", "&amp;").replace("\"", "&quot;")
        structureHandler.setAttribute("data-tr-state", attributeJson)
    }
}

private class ReactiveAttributeProcessor(
    attributeName: String,
    private val outputName: String
) : AbstractAttributeTagProcessor(
    TemplateMode.HTML,
    "tr",
    null,
    false,
    attributeName,
    true,
    1000,
    true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        structureHandler.setAttribute(outputName, attributeValue)
    }
}

private class ReactiveDynamicProcessor(
    attributeName: String,
    private val outputName: String
) : AbstractAttributeTagProcessor(
    TemplateMode.HTML, "tr", null, false, attributeName, true, 1000, true
) {
    override fun doProcess(
        context: ITemplateContext,
        tag: IProcessableElementTag,
        attributeName: AttributeName,
        attributeValue: String,
        structureHandler: IElementTagStructureHandler
    ) {
        structureHandler.setAttribute(outputName, attributeValue)
        when (outputName) {
            "data-tr-attr" -> attributeValue.split(",").forEach { binding ->
                val parts = binding.split(":", limit = 2)
                if (parts.size == 2) {
                    val name = parts[0].trim()
                    val value = evaluate(context, parts[1])
                    if (value == null || value == false) structureHandler.removeAttribute(name)
                    else structureHandler.setAttribute(name, value.toString())
                }
            }
            "data-tr-class" -> {
                val value = evaluate(context, attributeValue)
                if (value is Map<*, *>) {
                    structureHandler.setAttribute("class", value.entries.filter { it.value == true }.joinToString(" ") { it.key.toString() })
                } else if (value != null) structureHandler.setAttribute("class", value.toString())
            }
            "data-tr-style" -> {
                val value = evaluate(context, attributeValue)
                if (value is Map<*, *>) {
                    structureHandler.setAttribute("style", value.entries.joinToString("; ") { "${it.key}: ${it.value}" })
                } else if (value != null) structureHandler.setAttribute("style", value.toString())
            }
        }
    }
}
