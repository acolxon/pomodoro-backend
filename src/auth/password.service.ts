import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class PasswordService {
  private dummyHashPromise: Promise<string> | null = null;

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  /** Возвращает false (а не бросает ошибку) для повреждённого хеша. */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Хеш-пустышка для проверки пароля несуществующего пользователя.
   * Время ответа не должно выдавать, существует ли такой логин.
   */
  getDummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hash('tomato-dummy-password-for-timing');
    return this.dummyHashPromise;
  }
}
