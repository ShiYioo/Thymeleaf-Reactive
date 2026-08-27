/**
 * Converts the browser-safe Thymeleaf subset into runtime metadata.
 * This deliberately does not evaluate expressions; Spring/Thymeleaf remains
 * responsible for server-only expressions.
 */
export function compileElementAttributes(attributes) {
  const output = { attrs: {}, bindings: [] };
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'th:component') output.component = value;
    else if (name === 'th:key') output.key = value;
    else if (name === 'th:text') output.bindings.push({ kind: 'text', expression: value });
    else if (name === 'th:model') output.bindings.push({ kind: 'model', expression: value });
    else if (name === 'th:if') output.bindings.push({ kind: 'if', expression: value });
    else if (name === 'th:on') {
      const [event, handler] = String(value).split(':', 2);
      output.bindings.push({ kind: 'event', event, handler });
    } else output.attrs[name] = value;
  }
  return output;
}

export function compileTemplateMetadata(elements) {
  return elements.map(compileElementAttributes);
}
