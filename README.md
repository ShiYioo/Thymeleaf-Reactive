# Thymeleaf Reactive

A Vue-inspired reactive runtime for Thymeleaf applications.

The project is intentionally split into a browser runtime, a Thymeleaf compiler, and a Spring Boot starter. The first milestone proves the core invariant: changing reactive state patches only the affected DOM nodes.

## Milestone 1

- `thymeleaf-reactive-runtime`: dependency-tracked state, virtual DOM, keyed patching, and declarative event bindings.
- `thymeleaf-reactive-compiler`: translates reactive template bindings into runtime metadata.
- `thymeleaf-reactive-spring-boot-starter`: provides Spring Boot auto-configuration, browser bootstrap injection, template watching, and SSE HMR transport.

## Build baseline

- JDK 25
- Spring Boot 4.1.1
- Kotlin 2.4.10
- Gradle 9.7.1 via the checked-in Wrapper

Build with the checked-in Gradle Wrapper:

```powershell
./gradlew.bat test
```

## Example

Run the counter application with JDK 25:

```powershell
./gradlew.bat :examples:counter:bootRun
```

Then open `http://localhost:8080`. The template is watched directly from
`examples/counter/src/main/resources/templates`; changes to a `tr:component`
are fetched and patched in place during development.

Development HMR transport is exposed at `/__thymeleaf_reactive__/events` as an SSE stream. The browser Runtime will consume this stream and trigger component recompilation/patching.

In development mode the starter injects `/__thymeleaf_reactive__/bootstrap.js` into HTML responses automatically. No script tag is required. Set `thymeleaf.reactive.template-path` to a `file:` directory and the starter uses that same directory as the highest-priority Thymeleaf resolver, so edits are rendered immediately as well as watched. Template save events are debounced by 150 ms by default and can be configured:

```properties
thymeleaf.reactive.debounce-millis=150
thymeleaf.reactive.poll-interval-millis=500
thymeleaf.reactive.component-mappings.admin/dashboard.html=dashboard
```

`component-mappings` accepts template paths relative to `thymeleaf.reactive.template-path`; without an explicit mapping, the HTML file name is used as the component name.

Reactive lists can be rendered on the server with `tr:each`; repeated rows should use `tr:key` so HMR can preserve and move the corresponding DOM nodes:

```html
<li tr:each="item in items" tr:key="item.id">
  <span tr:text="item.label">Item</span>
</li>
```

## License

Apache-2.0
