package io.github.shiyioo.thymeleafreactive

import org.springframework.context.annotation.Condition
import org.springframework.context.annotation.ConditionContext
import org.springframework.core.type.AnnotatedTypeMetadata

class ReactiveFileTemplatePathCondition : Condition {
    override fun matches(context: ConditionContext, metadata: AnnotatedTypeMetadata): Boolean =
        context.environment.getProperty("thymeleaf.reactive.template-path", "classpath:/templates")
            .startsWith("file:")
}
