function stamp() {
  return new Date().toISOString();
}

function log(level, ...args) {
  console.log(`[${stamp()}] [${level}]`, ...args);
}

module.exports = {
  info: (...args) => log('INFO', ...args),
  warn: (...args) => log('WARN', ...args),
  error: (...args) => log('ERROR', ...args),
  debug: (...args) => log('DEBUG', ...args)
};
