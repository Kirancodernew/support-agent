// Runs before any test file imports the app, so env validation sees test values
// (dotenv never overrides variables that are already set).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.MONGODB_URI = 'mongodb://set-by-tests';
