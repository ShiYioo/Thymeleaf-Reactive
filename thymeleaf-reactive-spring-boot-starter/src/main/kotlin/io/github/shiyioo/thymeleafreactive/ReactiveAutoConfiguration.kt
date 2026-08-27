package io.github.shiyioo.thymeleafreactive

import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import tools.jackson.databind.ObjectMapper

@AutoConfiguration
@EnableConfigurationProperties(ReactiveProperties::class)
class ReactiveAutoConfiguration
{
    @Bean
    @ConditionalOnMissingBean(ReactiveDialect::class)
    fun reactiveDialect(objectMapper: ObjectMapper): ReactiveDialect = ReactiveDialect(objectMapper)
}
