package io.github.shiyioo.thymeleafreactive

import org.springframework.boot.autoconfigure.AutoConfiguration
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean

@AutoConfiguration
@EnableConfigurationProperties(ReactiveProperties::class)
class ReactiveAutoConfiguration
{
    @Bean
    @ConditionalOnMissingBean(ReactiveDialect::class)
    fun reactiveDialect(): ReactiveDialect = ReactiveDialect()
}
