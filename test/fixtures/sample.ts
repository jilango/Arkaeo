// Fixture file used by unit tests — do not import this at runtime.

import { readFileSync } from 'fs';
import * as path from 'path';

export interface User {
  id: string;
  name: string;
}

// Plain exported function
export function getUserById(userId: string): User {
  return { id: userId, name: 'Alice' };
}

// Arrow function assigned to a const
export const formatUser = (user: User): string => {
  return `${user.name} (${user.id})`;
};

// Named function expression
export const parseConfig = function parseConfig(raw: string): Record<string, string> {
  return JSON.parse(raw) as Record<string, string>;
};

// Class with methods
export class UserService {
  private users: User[] = [];

  addUser(user: User): void {
    this.users.push(user);
  }

  getUser(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }

  listUsers(): User[] {
    return [...this.users];
  }
}

// Unexported function (should still be detectable)
function internalHelper(data: string): string {
  return data.trim();
}

// TODO: replace this stub with a real implementation
// FIXME: edge case not handled for empty input
function riskyFunction(input: string): string {
  if (!input) return '';
  return internalHelper(input);
}
