import * as vscode from 'vscode';

const SECRET_KEY = 'arkaeo.anthropicApiKey';

/**
 * Prompts the user for their Anthropic API key and stores it in VS Code's
 * encrypted secrets store (OS keychain — never written to settings.json).
 */
export async function setApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  const existing = await secrets.get(SECRET_KEY);

  const input = await vscode.window.showInputBox({
    title: 'Arkaeo: Set Anthropic API Key',
    prompt: 'Enter your Anthropic API key (starts with sk-ant-…)',
    placeHolder: 'sk-ant-…',
    value: existing ? '••••••••' : '',
    password: true,
    validateInput: (v) => {
      if (!v || v.trim() === '' || v === '••••••••') return 'Please enter a valid API key.';
      if (!v.trim().startsWith('sk-ant-')) return 'Anthropic API keys start with "sk-ant-".';
      return undefined;
    },
  });

  if (!input || input === '••••••••') return;

  await secrets.store(SECRET_KEY, input.trim());
  void vscode.window.showInformationMessage('Arkaeo: API key saved securely.');
}

/**
 * Removes the stored API key.
 */
export async function clearApiKeyCommand(secrets: vscode.SecretStorage): Promise<void> {
  const existing = await secrets.get(SECRET_KEY);
  if (!existing) {
    void vscode.window.showInformationMessage('Arkaeo: No API key is currently stored.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    'Arkaeo: Remove your stored Anthropic API key?',
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;

  await secrets.delete(SECRET_KEY);
  void vscode.window.showInformationMessage('Arkaeo: API key removed.');
}

/**
 * Returns the stored API key, or undefined if not set.
 */
export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_KEY);
}
