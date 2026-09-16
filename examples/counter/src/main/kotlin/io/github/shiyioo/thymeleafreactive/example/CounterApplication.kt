package io.github.shiyioo.thymeleafreactive.example

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.stereotype.Controller
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
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

    @GetMapping("/tabs")
    fun tabs(): String = "tabs"

    @GetMapping("/plain")
    fun plain(): String = "plain"

    @GetMapping("/form")
    fun form(): String = "form"

    @PostMapping("/form/submit")
    fun submit(@RequestParam name: String?, @RequestParam email: String?): String =
        if (name.isNullOrBlank() || email.isNullOrBlank()) "redirect:/form/error"
        else "redirect:/form/success?name=" + java.net.URLEncoder.encode(name, java.nio.charset.StandardCharsets.UTF_8)

    @GetMapping("/form/success")
    fun success(@RequestParam name: String, model: Model): String {
        model.addAttribute("name", name)
        return "success"
    }

    @GetMapping("/form/error")
    fun error(): String = "error"

}

fun main(args: Array<String>) {
    runApplication<CounterApplication>(*args)
}
