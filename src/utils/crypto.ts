import crypto from 'crypto';

export class CryptoUtils {
  private static readonly ALGORITHM = 'aes-256-cbc';
  private static readonly KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly SALT_LENGTH = 16;

  static encrypt(text: string, password: string): string {
    const salt = crypto.randomBytes(CryptoUtils.SALT_LENGTH);
    const key = crypto.pbkdf2Sync(password, salt, 100000, CryptoUtils.KEY_LENGTH, 'sha256');
    
    const iv = crypto.randomBytes(CryptoUtils.IV_LENGTH);
    const cipher = crypto.createCipheriv(CryptoUtils.ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return Buffer.concat([salt, iv, Buffer.from(encrypted, 'hex')]).toString('base64');
  }

  static decrypt(encryptedText: string, password: string): string {
    const data = Buffer.from(encryptedText, 'base64');
    
    const salt = data.subarray(0, CryptoUtils.SALT_LENGTH);
    const iv = data.subarray(CryptoUtils.SALT_LENGTH, CryptoUtils.SALT_LENGTH + CryptoUtils.IV_LENGTH);
    const encrypted = data.subarray(CryptoUtils.SALT_LENGTH + CryptoUtils.IV_LENGTH);
    
    const key = crypto.pbkdf2Sync(password, salt, 100000, CryptoUtils.KEY_LENGTH, 'sha256');
    
    const decipher = crypto.createDecipheriv(CryptoUtils.ALGORITHM, key, iv);
    
    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  static hash(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  static generateSecureRandom(length: number): string {
    return crypto.randomBytes(length).toString('hex');
  }
}

// Export individual functions for backward compatibility
export const encrypt = CryptoUtils.encrypt;
export const decrypt = CryptoUtils.decrypt;