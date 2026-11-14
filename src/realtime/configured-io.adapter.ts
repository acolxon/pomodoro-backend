import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Server, ServerOptions } from 'socket.io';

/** Socket.IO reads the same validated origin list as HTTP CORS. */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly origins: string[];

  constructor(app: INestApplication, config: ConfigService) {
    super(app);
    this.origins = config
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  createIOServer(port: number | undefined, options?: Partial<ServerOptions>): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: true },
      // CORS alone does not reject a WebSocket transport with an untrusted Origin.
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        const allowed = origin === undefined || this.origins.includes(origin);
        callback(allowed ? null : 'Origin is not allowed', allowed);
      },
    } satisfies Partial<ServerOptions>);
  }
}
