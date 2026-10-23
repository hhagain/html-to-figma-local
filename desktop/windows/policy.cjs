const actions = new Set(['open-workbench', 'show-plugin', 'restart', 'quit', 'copy-code', 'pair-approve', 'pair-reject']);
function trustedOrigin(value, serviceURL) {
  try {
    const source = new URL(value), service = new URL(serviceURL);
    return service.protocol === 'http:' && service.hostname === '127.0.0.1' &&
      Number(service.port) >= 3847 && Number(service.port) <= 3851 && source.origin === service.origin;
  } catch { return false; }
}
function nativeCommand(payload, { url, serviceURL, mainFrame, pendingPairIDs }) {
  if (!mainFrame || !trustedOrigin(url, serviceURL) || !payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const pathname = new URL(url).pathname;
  if (!['/', '/desktop'].includes(pathname) || !actions.has(payload.action)) return null;
  if (payload.action.startsWith('pair-')) {
    if (pathname !== '/desktop' || typeof payload.id !== 'string' || !pendingPairIDs.has(payload.id)) return null;
    return { action: payload.action, id: payload.id };
  }
  return { action: payload.action };
}
module.exports = { trustedOrigin, nativeCommand };
