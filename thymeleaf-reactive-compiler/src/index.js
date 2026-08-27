/**
 * Converts the browser-safe Thymeleaf subset into runtime metadata.
 * This deliberately does not evaluate expressions; Spring/Thymeleaf remains
 * responsible for server-only expressions.
 */
export function compileElementAttributes(attributes) {
  const output = { attrs: {}, runtimeAttrs: {}, bindings: [] };
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'th:component') output.component = value;
    else if (name === 'th:key') { output.key = value; output.runtimeAttrs['data-tr-key'] = value; }
    else if (name === 'th:text') { output.bindings.push({ kind: 'text', expression: value }); output.runtimeAttrs['data-tr-text'] = value; }
    else if (name === 'th:model') { output.bindings.push({ kind: 'model', expression: value }); output.runtimeAttrs['data-tr-model'] = value; }
    else if (name === 'th:if') { output.bindings.push({ kind: 'if', expression: value }); output.runtimeAttrs['data-tr-show'] = value; }
    else if (name === 'th:on') {
      const [event, handler] = String(value).split(':', 2);
      output.bindings.push({ kind: 'event', event, handler });
      output.runtimeAttrs['data-tr-on'] = `${event}:${handler}`;
    } else output.attrs[name] = value;
  }
  return output;
}

export function toRuntimeAttributes(attributes) {
  return compileElementAttributes(attributes).runtimeAttrs;
}

export function compileTemplateMetadata(elements) {
  return elements.map(compileElementAttributes);
}
