package io.github.shiyioo.thymeleafreactive

import org.springframework.boot.context.properties.ConfigurationProperties

@ConfigurationProperties("thymeleaf.reactive")
data class ReactiveProperties(
    var enabled: Boolean = true,
    var developmentMode: Boolean = true,
    var templatePath: String = "classpath:/templates",
    var runtimePath: String = "/thymeleaf-reactive/runtime.js"
)
