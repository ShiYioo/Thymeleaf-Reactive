package io.github.shiyioo.thymeleafreactive.example

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping

@SpringBootApplication
class CounterApplication

@Controller
class CounterController {
    @GetMapping("/")
    fun index(): String = "index"
}

fun main(args: Array<String>) {
    runApplication<CounterApplication>(*args)
}
