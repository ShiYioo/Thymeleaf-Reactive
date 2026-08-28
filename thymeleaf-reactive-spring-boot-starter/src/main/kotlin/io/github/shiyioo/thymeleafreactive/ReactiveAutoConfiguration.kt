package io.github.shiyioo.thymeleafreactive

import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Conditional
import tools.jackson.databind.ObjectMapper
import org.thymeleaf.spring6.templateresolver.SpringResourceTemplateResolver
import org.thymeleaf.templatemode.TemplateMode

@AutoConfiguration
@EnableConfigurationProperties(ReactiveProperties::class)
class ReactiveAutoConfiguration
{
    @Bean
    @ConditionalOnMissingBean(ReactiveDialect::class)
    fun reactiveDialect(objectMapper: ObjectMapper): ReactiveDialect = ReactiveDialect(objectMapper)

    @Bean
    @ConditionalOnMissingBean
    fun templateChangeBroadcaster(properties: ReactiveProperties): TemplateChangeBroadcaster = TemplateChangeBroadcaster(properties)

    @Bean
    @ConditionalOnMissingBean
    fun hmrController(changes: TemplateChangeBroadcaster): HmrController = HmrController(changes)

    @Bean
    @ConditionalOnMissingBean
    fun runtimeController(): RuntimeController = RuntimeController()

    @Bean
    @Conditional(ReactiveFileTemplatePathCondition::class)
    fun reactiveFileTemplateResolver(properties: ReactiveProperties): SpringResourceTemplateResolver =
        SpringResourceTemplateResolver().apply {
            prefix = properties.templatePath.ensureTrailingSlash()
            suffix = ".html"
            templateMode = TemplateMode.HTML
            order = 0
            isCacheable = !properties.developmentMode
            checkExistence = true
        }

    @Bean
    @ConditionalOnMissingBean
    fun reactiveRuntimeInjectionFilter(properties: ReactiveProperties): ReactiveRuntimeInjectionFilter =
        ReactiveRuntimeInjectionFilter(properties)
}

private fun String.ensureTrailingSlash(): String = if (endsWith('/')) this else "$this/"
