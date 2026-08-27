# Thymeleaf Reactive

A Vue-inspired reactive runtime for Thymeleaf applications.

The project is intentionally split into a browser runtime, a Thymeleaf compiler, and a Spring Boot starter. The first milestone proves the core invariant: changing reactive state patches only the affected DOM nodes.

## Milestone 1

- `thymeleaf-reactive-runtime`: dependency-tracked state, virtual DOM, keyed patching, and declarative event bindings.
- `thymeleaf-reactive-compiler`: reserved for translating `th:*` bindings into runtime metadata.
- `thymeleaf-reactive-spring-boot-starter`: reserved for Spring Boot auto-configuration and HMR transport.

## License

Apache-2.0
