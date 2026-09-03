// Render skill invocations for the host that loaded the plugin. Codex exposes
// PLUGIN_ROOT; CLAUDE_PLUGIN_ROOT may also be present there for compatibility,
// so the Codex-specific variable must win.

export function detectHost(env = process.env) {
  if (env.PLUGIN_ROOT) return 'codex'
  if (env.CLAUDE_PLUGIN_ROOT || env.CURSOR_PLUGIN_ROOT) return 'claude'
  if (env.CODEX_HOME) return 'codex'
  return null
}

export function invocationOptions(env = process.env) {
  const host = detectHost(env)
  return host === 'claude' && env.CLAUDE_PLUGIN_ROOT
    ? { host, namespace: 'maxgfr' }
    : { host }
}

export function formatInvocation(skill, args = [], options = {}) {
  const suffix = args.length ? ` ${args.join(' ')}` : ''
  if (options.host === 'codex') return `$${skill}${suffix}`
  if (options.host === 'claude') {
    const name = options.namespace ? `${options.namespace}:${skill}` : skill
    return `/${name}${suffix}`
  }
  return `invoke the ${skill} skill${suffix}`
}
