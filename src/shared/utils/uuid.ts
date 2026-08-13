import { v4 as uuidv4, v4 } from 'uuid';
import { UUIDGenerator } from '../../shared/types/uuid';

export class UUIDAdapter implements UUIDGenerator {
  generate(): string {
    return uuidv4();
  }

  generateV4(): string {
    return v4();
  }
}
