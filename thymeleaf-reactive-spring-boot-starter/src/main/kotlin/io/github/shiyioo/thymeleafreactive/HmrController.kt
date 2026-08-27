package io.github.shiyioo.thymeleafreactive

import org.springframework.http.MediaType
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList
import java.util.function.Consumer

@RestController
@RequestMapping("/__thymeleaf_reactive__")
class HmrController(private val changes: TemplateChangeBroadcaster) {
    private val clients = CopyOnWriteArrayList<SseEmitter>()

    init {
        changes.subscribe(Consumer { change ->
            clients.removeIf { emitter ->
                try {
                    emitter.send(change, MediaType.APPLICATION_JSON)
                    false
                } catch (_: IOException) {
                    emitter.complete()
                    true
                }
            }
        })
    }

    @GetMapping("/events", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(): SseEmitter {
        val emitter = SseEmitter(0L)
        emitter.onCompletion { clients.remove(emitter) }
        emitter.onTimeout { clients.remove(emitter) }
        clients += emitter
        return emitter
    }
}
