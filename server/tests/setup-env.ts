// Runs in every test worker before any application module is imported.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'mysql://hqms:hqms_dev_pw@127.0.0.1:3306/hqms_test';
process.env.LOGIN_RATE_LIMIT ??= '1000';
process.env.LOGIN_MAX_FAILED ??= '5';
process.env.PASSWORD_MIN_LENGTH ??= '10';
process.env.OUTBOX_POLL_MS ??= '50';
