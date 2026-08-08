/** Preferências de “Salvar senha / entrar automático” na /auth. */

export const AUTH_SAVE_PASSWORD_KEY = "igreen:auth:save-password";
export const AUTH_REMEMBER_EMAIL_KEY = "igreen:auth:remember-email";

export function readSavePasswordPref(): boolean {
  try {
    return localStorage.getItem(AUTH_SAVE_PASSWORD_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSavePasswordPref(on: boolean): void {
  try {
    localStorage.setItem(AUTH_SAVE_PASSWORD_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function readRememberedEmail(): string {
  try {
    if (!readSavePasswordPref()) return "";
    return localStorage.getItem(AUTH_REMEMBER_EMAIL_KEY)?.trim() || "";
  } catch {
    return "";
  }
}

export function writeRememberedEmail(email: string | null): void {
  try {
    if (!email) {
      localStorage.removeItem(AUTH_REMEMBER_EMAIL_KEY);
      return;
    }
    localStorage.setItem(AUTH_REMEMBER_EMAIL_KEY, email.trim());
  } catch {
    /* ignore */
  }
}

type StoredCred = { id: string; password: string };

/** Chrome/Edge: grava no gerenciador de senhas do navegador. */
export async function storeBrowserPassword(email: string, password: string): Promise<void> {
  try {
    const PasswordCred = (window as unknown as { PasswordCredential?: new (data: {
      id: string;
      password: string;
      name?: string;
    }) => Credential }).PasswordCredential;
    if (!PasswordCred || !navigator.credentials?.store) return;
    const cred = new PasswordCred({ id: email, password, name: email });
    await navigator.credentials.store(cred);
  } catch {
    /* usuário cancelou ou API indisponível */
  }
}

/** Tenta ler senha salva (entra automático quando o navegador permitir). */
export async function getBrowserPassword(): Promise<StoredCred | null> {
  try {
    if (!navigator.credentials?.get) return null;
    const cred = await navigator.credentials.get({
      password: true,
      mediation: "optional",
    } as CredentialRequestOptions);
    if (!cred || cred.type !== "password") return null;
    const pc = cred as Credential & { id: string; password?: string };
    if (!pc.id || !pc.password) return null;
    return { id: pc.id, password: pc.password };
  } catch {
    return null;
  }
}
