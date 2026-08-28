package io.github.shiyioo.thymeleafreactive

import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.ResponseBody
import org.springframework.web.bind.annotation.RequestParam

@RestController
@RequestMapping("/__thymeleaf_reactive__")
class RuntimeController {
    @GetMapping("/bootstrap.js", produces = ["text/javascript"])
    @ResponseBody
    fun runtimeBootstrap(@RequestParam(required = false) t: String?): String =
        "import '/thymeleaf-reactive/browser.js${t?.let { "?t=$it" } ?: ""}';"
}
