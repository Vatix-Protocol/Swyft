// Jest setup for the API test environment. The class-validator/class-transformer
// decorators (e.g. in request-validation/pagination.dto.ts) read metadata via
// `Reflect`, which Node does not provide automatically. Register the polyfill
// here so the request-validation and other DTO specs run without a
// "Reflect.getMetadata is not a function" error.
require('reflect-metadata');
