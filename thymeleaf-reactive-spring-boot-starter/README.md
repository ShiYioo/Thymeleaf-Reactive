# Thymeleaf Reactive Spring Boot Starter

Spring Boot integration is planned here: auto-configuration, runtime asset injection, template watching, and WebSocket HMR transport.

The development event endpoint is currently exposed as Server-Sent Events at `/__thymeleaf_reactive__/events`. The browser package provides `connectHmr()` for subscribing to it.
