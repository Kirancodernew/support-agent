// Runs before any test file imports the app, so env validation sees test values
// (dotenv never overrides variables that are already set). The services these point at are
// never contacted: tests pass in-memory fakes (see fakes.ts).
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  MONGODB_URI: 'mongodb://set-by-tests',
  REDIS_URL: 'redis://unused',
  AWS_REGION: 'test',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  S3_BUCKET: 'test-bucket',
  GEMINI_API_KEY: 'test',
});
