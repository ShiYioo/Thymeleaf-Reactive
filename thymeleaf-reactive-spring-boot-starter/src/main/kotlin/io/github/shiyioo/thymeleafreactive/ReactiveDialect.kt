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

class ReactiveDialect(private val objectMapper: ObjectMapper) : AbstractProcessorDialect("Thymeleaf Reactive", "tr", 1000) {
    override fun getProcessors(dialectPrefix: String): Set<IProcessor> = setOf(
        ReactiveAttributeProcessor("component", "data-tr-component"),
        ReactiveAttributeProcessor("key", "data-tr-key"),
        ReactiveStateProcessor(objectMapper),
        ReactiveAttributeProcessor("text", "data-tr-text"),
        ReactiveAttributeProcessor("model", "data-tr-model"),
        ReactiveAttributeProcessor("if", "data-tr-if"),
        ReactiveAttributeProcessor("show", "data-tr-show"),
        ReactiveAttributeProcessor("on", "data-tr-on")
    )
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
