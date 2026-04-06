import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_FILE = 'token.dat';

class TokenStore {
  private get tokenPath(): string {
    return path.join(app.getPath('userData'), TOKEN_FILE);
  }

  save(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(token);
      fs.writeFileSync(this.tokenPath, encrypted);
    } else {
      console.warn('TokenStore: safeStorage encryption unavailable, storing token as plain text');
      fs.writeFileSync(this.tokenPath, token, 'utf8');
    }
  }

  load(): string | null {
    if (!fs.existsSync(this.tokenPath)) {
      return null;
    }

    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = fs.readFileSync(this.tokenPath);
        return safeStorage.decryptString(encrypted);
      } else {
        return fs.readFileSync(this.tokenPath, 'utf8');
      }
    } catch (err) {
      console.error('TokenStore: failed to load token', err);
      return null;
    }
  }

  clear(): void {
    if (fs.existsSync(this.tokenPath)) {
      fs.unlinkSync(this.tokenPath);
    }
  }
}

export default new TokenStore();
