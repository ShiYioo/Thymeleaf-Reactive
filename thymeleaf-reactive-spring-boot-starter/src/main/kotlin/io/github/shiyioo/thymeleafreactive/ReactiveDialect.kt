package io.github.shiyioo.thymeleafreactive

import org.thymeleaf.dialect.AbstractProcessorDialect
import org.thymeleaf.processor.IProcessor
import org.thymeleaf.templatemode.TemplateMode
import org.thymeleaf.processor.element.AbstractAttributeTagProcessor
import org.thymeleaf.processor.element.IElementTagStructureHandler
import org.thymeleaf.context.ITemplateContext
import org.thymeleaf.model.IProcessableElementTag
import org.thymeleaf.engine.AttributeName

class ReactiveDialect : AbstractProcessorDialect("Thymeleaf Reactive", "tr", 1000) {
    override fun getProcessors(templateMode: TemplateMode): Set<IProcessor> = setOf(
        ReactiveAttributeProcessor("component", "data-tr-component"),
        ReactiveAttributeProcessor("state", "data-tr-state"),
        ReactiveAttributeProcessor("text", "data-tr-text"),
        ReactiveAttributeProcessor("model", "data-tr-model"),
        ReactiveAttributeProcessor("show", "data-tr-show"),
        ReactiveAttributeProcessor("on", "data-tr-on")
    )
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
