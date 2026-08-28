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
        ReactiveAttributeProcessor("key", "data-tr-key"),
        ReactiveStateProcessor(objectMapper),
        ReactiveTextProcessor(),
        ReactiveAttributeProcessor("model", "data-tr-model"),
        ReactiveIfProcessor(),
        ReactiveAttributeProcessor("show", "data-tr-show"),
        ReactiveAttributeProcessor("on", "data-tr-on")
    )
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
        if (evaluate(context, attributeValue) != true) structureHandler.removeElement()
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
        structureHandler.setAttribute("data-tr-state", json)
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
