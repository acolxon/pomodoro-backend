import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { IncomingMessage } from 'http';
import { Server } from 'socket.io';
import { ConfiguredIoAdapter } from './configured-io.adapter';

describe('Configured Socket.IO origin policy', () => {
  afterEach(() => jest.restoreAllMocks());

  function options() {
    const create = jest.spyOn(IoAdapter.prototype, 'createIOServer').mockReturnValue({} as Server);
    const adapter = new ConfiguredIoAdapter(
      {} as INestApplication,
      new ConfigService({ CORS_ORIGINS: ' https://tomato.example, http://localhost:5173 ' }),
    );
    adapter.createIOServer(undefined);
    return create.mock.calls[0][1]!;
  }

  it('uses the configured list for browser CORS instead of reflecting arbitrary origins', () => {
    expect(options().cors).toEqual({
      origin: ['https://tomato.example', 'http://localhost:5173'],
      credentials: true,
    });
  });

  it.each(['https://tomato.example', 'http://localhost:5173', undefined])(
    'allows configured or absent Origin: %s',
    (origin) => {
      const callback = jest.fn();
      options().allowRequest!({ headers: { origin } } as IncomingMessage, callback);
      expect(callback).toHaveBeenCalledWith(null, true);
    },
  );

  it.each(['https://evil.example', 'https://tomato.example.evil.example', 'null', ''])(
    'rejects an untrusted websocket Origin: %s',
    (origin) => {
      const callback = jest.fn();
      options().allowRequest!({ headers: { origin } } as IncomingMessage, callback);
      expect(callback).toHaveBeenCalledWith(expect.any(String), false);
    },
  );
});
