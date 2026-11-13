/** Пользователь, прикреплённый к запросу после проверки JWT. */
export interface AuthUser {
  id: string;
  username: string;
}

/** Содержимое JWT access-токена. */
export interface JwtPayload {
  sub: string;
  username: string;
}
