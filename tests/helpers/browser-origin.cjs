function browserTestOrigin(explicit) {
  const configured = explicit?.trim() || process.env.LUMIX_TEST_ORIGIN?.trim();
  const port = process.env.PORT?.trim();
  if (!configured && (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) {
    throw new Error('Set LUMIX_TEST_ORIGIN, the suite-specific base URL, or PORT to target the running frontend.');
  }
  const url = new URL(configured || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an HTTP(S) test origin without credentials.');
  return url.origin;
}
module.exports = { browserTestOrigin };
