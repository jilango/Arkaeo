import * as vscode from 'vscode';

const SECRET_KEY = 'arkaeo.openaiApiKey';

/**
 * Prompts the user for their OpenAI API key and stores it in VS Code's
 * encrypted secrets store (OS keychain — never written to settings.json).
 */
export async function setApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  const existing = await secrets.get(SECRET_KEY);

  const input = await vscode.window.showInputBox({
    title: 'Arkaeo: Set OpenAI API Key',
    prompt: 'Enter your OpenAI API key (starts with sk-…)',
    placeHolder: 'sk-…',
    value: existing ? '••••••••' : '',
    password: true,   // masks input + excludes from command history
    validateInput: (v) => {
      if (!v || v.trim() === '' || v === '••••••••') return 'Please enter a valid API key.';
      if (!v.trim().startsWith('sk-')) return 'OpenAI API keys start with "sk-".';
      return undefined;
    },
  });

  if (!input || input === '••••••••') return; // user cancelled or unchanged

  await secrets.store(SECRET_KEY, input.trim());
  void vscode.window.showInformationMessage('Arkaeo: API key saved securely.');
}

/**
 * Removes the stored API key and hides the AI section from the panel.
 */
export async function clearApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  const existing = await secrets.get(SECRET_KEY);
  if (!existing) {
    void vscode.window.showInformationMessage('Arkaeo: No API key is currently stored.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Arkaeo: Remove your stored OpenAI API key?',
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;

  await secrets.delete(SECRET_KEY);
  void vscode.window.showInformationMessage('Arkaeo: API key removed.');
}

/**
 * Returns the stored API key, or undefined if not set.
 * Centralises secret access so the key never passes through settings.json.
 */
export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_KEY);
}
