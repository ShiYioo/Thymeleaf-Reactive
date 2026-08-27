package io.github.shiyioo.thymeleafreactive.example

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.ui.Model

@SpringBootApplication
class CounterApplication

@Controller
class CounterController {
    @GetMapping("/")
    fun index(model: Model): String {
        model.addAttribute("counter", mapOf("count" to 0, "visible" to true))
        return "index"
    }
}

fun main(args: Array<String>) {
    runApplication<CounterApplication>(*args)
}
