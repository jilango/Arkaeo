// Fixture file — imported by dependencyAnalyzer tests.
// Intentionally imports from sample.ts to create a known dependency graph.

import { getUserById, UserService } from './sample';

export function displayUser(userId: string): string {
  const user = getUserById(userId);
  return `User: ${user.name}`;
}

export function createService(): UserService {
  return new UserService();
}
