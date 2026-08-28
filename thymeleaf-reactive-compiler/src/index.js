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
    else if (name === 'th:if') { output.bindings.push({ kind: 'if', expression: value }); output.runtimeAttrs['data-tr-if'] = value; }
    else if (name === 'th:on') {
      const [event, handler] = String(value).split(':', 2);
      output.bindings.push({ kind: 'event', event, handler });
      output.runtimeAttrs['data-tr-on'] = `${event}:${handler}`;
    } else if (name === 'th:attr') {
      output.bindings.push({ kind: 'attr', expression: value });
      output.runtimeAttrs['data-tr-attr'] = value;
    } else if (name === 'th:class') {
      output.bindings.push({ kind: 'class', expression: value });
      output.runtimeAttrs['data-tr-class'] = value;
    } else if (name === 'th:style') {
      output.bindings.push({ kind: 'style', expression: value });
      output.runtimeAttrs['data-tr-style'] = value;
    } else if (name === 'th:each') {
      output.bindings.push({ kind: 'each', expression: value });
      output.runtimeAttrs['data-tr-each'] = value;
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
