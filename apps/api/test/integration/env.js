// Loads .env and redirects the API to the isolated test database before any module is imported.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL must be set for integration tests');
if (!/test/i.test(testUrl)) throw new Error('TEST_DATABASE_URL must point at a database whose name contains "test"');
process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';
process.env.MFA_ENFORCEMENT = 'required';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = path.resolve(__dirname, '../../.storage-test');
process.env.SMTP_HOST = '';
process.env.PAYMENT_REQUIRE_SEPARATE_VERIFIER = 'true';
process.env.PAYROLL_COMPLIANCE_CERTIFIED = 'false';
