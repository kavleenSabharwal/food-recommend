function log(level, message) {
  const shouldLog = process.env.VERBOSE === 'true' || level === 'error';
  if (shouldLog) console[level](`[${level.toUpperCase()}] ${message}`);
}
module.exports = { log };
