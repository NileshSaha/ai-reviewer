export interface UUIDGenerator {
  generate(): string;
  generateV4(): string;
}

export const UUID_GENERATOR_TOKEN = Symbol('UUIDGenerator');
