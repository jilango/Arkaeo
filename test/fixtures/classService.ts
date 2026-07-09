import { HelperA } from './helperA';
import { helperFn } from './helperB';
import type { HelperLabel } from './helperB';

export class ClassService {
  private readonly store: HelperA;

  constructor(private readonly a: HelperA) {
    this.store = a;
  }

  run(): HelperLabel {
    this.a.detect();
    this.store.detect();
    return helperFn();
  }
}
