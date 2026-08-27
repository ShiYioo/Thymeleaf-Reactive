package io.github.shiyioo.thymeleafreactive

import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.bind.annotation.ResponseBody

@RestController
@RequestMapping("/__thymeleaf_reactive__")
class RuntimeController {
    @GetMapping("/runtime.js", produces = ["text/javascript"])
    @ResponseBody
    fun runtimeBootstrap(): String = """
        (() => {
          if (!window.EventSource) return;
          const source = new EventSource('/__thymeleaf_reactive__/events');
          source.onmessage = (event) => {
            try {
              const message = JSON.parse(event.data);
              window.dispatchEvent(new CustomEvent('thymeleaf-reactive:template-change', { detail: message }));
            } catch (error) {
              console.warn('[thymeleaf-reactive] invalid HMR event', error);
            }
          };
          source.onerror = () => console.warn('[thymeleaf-reactive] HMR connection lost; retrying');
          window.addEventListener('beforeunload', () => source.close(), { once: true });
        })();
    """.trimIndent()
}
