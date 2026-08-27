# Thymeleaf Reactive

A Vue-inspired reactive runtime for Thymeleaf applications.

The project is intentionally split into a browser runtime, a Thymeleaf compiler, and a Spring Boot starter. The first milestone proves the core invariant: changing reactive state patches only the affected DOM nodes.

## Milestone 1

- `thymeleaf-reactive-runtime`: dependency-tracked state, virtual DOM, keyed patching, and declarative event bindings.
- `thymeleaf-reactive-compiler`: reserved for translating `th:*` bindings into runtime metadata.
- `thymeleaf-reactive-spring-boot-starter`: reserved for Spring Boot auto-configuration and HMR transport.

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

## License

Apache-2.0
