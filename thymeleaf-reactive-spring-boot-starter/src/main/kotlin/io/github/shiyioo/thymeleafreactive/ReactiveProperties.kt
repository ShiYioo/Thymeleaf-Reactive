package io.github.shiyioo.thymeleafreactive

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("thymeleaf.reactive")
data class ReactiveProperties(
    var enabled: Boolean = true,
    var developmentMode: Boolean = true,
    var templatePath: String = "classpath:/templates",
    var runtimePath: String = "/__thymeleaf_reactive__/bootstrap.js",
    var debounceMillis: Long = 150,
    var pollIntervalMillis: Long = 500,
    var componentMappings: Map<String, String> = emptyMap()
)
