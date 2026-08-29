# Thymeleaf Reactive Spring Boot Starter

Spring Boot integration is planned here: auto-configuration, runtime asset injection, template watching, and WebSocket HMR transport.

The development event endpoint is currently exposed as Server-Sent Events at `/__thymeleaf_reactive__/events`. The browser package provides `connectHmr()` for subscribing to it.

The Starter packages the TypeScript browser runtime at `/thymeleaf-reactive/browser.js` and exposes `/__thymeleaf_reactive__/bootstrap.js` as a module entry point.

Use the reactive dialect in a Thymeleaf page:

```html
<section tr:component="counter" tr:state="${counter}">
  <strong tr:text="count"></strong>
  <input tr:model="count">
  <button tr:on="click:increment">+</button>
</section>
<script type="module" src="/__thymeleaf_reactive__/bootstrap.js"></script>
```

`tr:state` accepts JSON directly or a simple server model reference such as
`${counter}`. The latter is serialized with the application `ObjectMapper`.
`tr:on="click:handler"` invokes `handler(state, event)` and accepts Vue-style
event modifiers such as `.prevent`, `.stop`, `.self`, `.once`, keyboard, mouse,
and system modifiers.
