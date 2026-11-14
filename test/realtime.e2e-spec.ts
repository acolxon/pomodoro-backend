import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import { PomodoroService } from '../src/pomodoro/pomodoro.service';
import { createTestApp, RegisteredUser, registerUser, resetData } from './utils/test-app';

interface TestSocket {
  id?: string;
  on(event: string, listener: (...values: any[]) => void): void;
  off(event: string, listener: (...values: any[]) => void): void;
  emit(event: string, ...values: any[]): void;
  connect(): void;
  disconnect(): void;
}
// Reuse the official browser client already distributed with socket.io.
// Supply the existing ws transport for Node 20+, without a new dependency.
const globals = globalThis as unknown as { WebSocket?: unknown };
const originalWebSocket = globals.WebSocket;
globals.WebSocket = WebSocket;
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js') as {
  io(url: string, options: Record<string, unknown>): TestSocket;
};

interface EventWait<T> {
  promise: Promise<T>;
  stop: () => void;
}
function waitEvent<T>(
  client: TestSocket,
  event: string,
  matches: (value: T) => boolean = () => true,
): EventWait<T> {
  let handler: (value: T) => void;
  let timer: ReturnType<typeof setTimeout>;
  const stop = () => {
    clearTimeout(timer);
    client.off(event, handler);
  };
  const promise = new Promise<T>((resolve, reject) => {
    handler = (value) => {
      if (matches(value)) {
        stop();
        resolve(value);
      }
    };
    timer = setTimeout(() => {
      stop();
      reject(new Error(`Timed out waiting for ${event}`));
    }, 3000);
    client.on(event, handler);
  });
  return { promise, stop };
}
function command<T = any>(client: TestSocket, event: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      client.off('exception', failed);
    };
    const failed = (error: unknown) => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`No acknowledgement for ${event}`));
    }, 3000);
    client.on('exception', failed);
    client.emit(event, body, (value: T) => {
      cleanup();
      resolve(value);
    });
  });
}

describe('Realtime room events and timer isolation (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let endpoint: string;
  const clients: TestSocket[] = [];
  const waits: EventWait<unknown>[] = [];
  const http = () => request(app.getHttpServer());
  const as = (user: RegisteredUser) => ({ Authorization: `Bearer ${user.token}` });

  beforeAll(async () => {
    ({ app, dataSource: ds } = await createTestApp());
    endpoint = await app.getUrl();
  });
  beforeEach(async () => {
    await resetData(ds);
  });
  afterEach(() => {
    waits.splice(0).forEach((wait) => wait.stop());
    clients.splice(0).forEach((client) => client.disconnect());
    app.get(PomodoroService).onModuleDestroy();
  });
  afterAll(async () => {
    if (app) await app.close();
    globals.WebSocket = originalWebSocket;
  });

  function next<T = any>(client: TestSocket, event: string, matches?: (value: T) => boolean) {
    const wait = waitEvent<T>(client, event, matches);
    waits.push(wait as EventWait<unknown>);
    return wait.promise;
  }
  async function connect(user: RegisteredUser) {
    const client = io(endpoint, {
      transports: ['websocket'],
      auth: { token: user.token },
      reconnection: false,
      autoConnect: false,
      timeout: 2500,
    });
    clients.push(client);
    const ready = next<{ userId: string }>(client, 'realtime:ready');
    client.connect();
    expect((await ready).userId).toBe(user.id);
    return client;
  }
  async function createRoom(owner: RegisteredUser, name: string) {
    return (await http().post('/rooms').set(as(owner)).send({ name }).expect(201)).body as {
      id: string;
      inviteCode: string;
    };
  }
  async function join(user: RegisteredUser, inviteCode: string) {
    await http().post('/rooms/join').set(as(user)).send({ inviteCode }).expect(200);
  }

  it('notifies private user channels on creation/join and room subscribers on ownership changes', async () => {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');
    const a = await connect(alice);
    const created = next(a, 'room:updated');
    const room = await createRoom(alice, 'Study');
    expect(await created).toMatchObject({ roomId: room.id });
    await command(a, 'room:join', { roomId: room.id });
    const b = await connect(bob);
    const joinedSelf = next(b, 'room:updated');
    const joinedRoom = next(a, 'room:updated');
    await join(bob, room.inviteCode);
    expect(await joinedSelf).toMatchObject({ roomId: room.id });
    expect(await joinedRoom).toMatchObject({ roomId: room.id });
    await command(b, 'room:join', { roomId: room.id });
    const changedA = next(a, 'room:updated');
    const changedB = next(b, 'room:updated');
    await http()
      .patch(`/rooms/${room.id}/owner`)
      .set(as(alice))
      .send({ newOwnerId: bob.id })
      .expect(200);
    expect(await changedA).toMatchObject({ roomId: room.id });
    expect(await changedB).toMatchObject({ roomId: room.id });
    await expect(command(a, 'pomodoro:start', { roomId: room.id })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: expect.any(String),
    });
    expect(await command(b, 'pomodoro:start', { roomId: room.id })).toMatchObject({
      status: 'running',
      phase: 'focus',
    });
  });

  it('restores the latest membership, owner and timer after reconnect and resumes room events', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const newcomer = await registerUser(app, 'newcomer');
    const room = await createRoom(owner, 'Reconnect');
    await join(member, room.inviteCode);
    const ownerSocket = await connect(owner);
    const memberSocket = await connect(member);
    await command(ownerSocket, 'room:join', { roomId: room.id });
    const initial = await command(memberSocket, 'room:join', { roomId: room.id });
    expect(initial.room.ownerId).toBe(owner.id);
    expect(initial.members).toHaveLength(2);
    expect(initial.pomodoro.status).toBe('idle');

    const oldSocketId = memberSocket.id;
    const serverSocket = app.get(RealtimeGateway).server.sockets.sockets.get(oldSocketId!);
    expect(serverSocket).toBeDefined();
    await new Promise<void>((resolve) => {
      serverSocket!.once('disconnect', () => resolve());
      memberSocket.disconnect();
    });
    await join(newcomer, room.inviteCode);
    const started = await command(ownerSocket, 'pomodoro:start', { roomId: room.id });
    await http()
      .patch(`/rooms/${room.id}/owner`)
      .set(as(owner))
      .send({ newOwnerId: member.id })
      .expect(200);

    const ready = next<{ userId: string }>(memberSocket, 'realtime:ready');
    memberSocket.connect();
    expect((await ready).userId).toBe(member.id);
    expect(memberSocket.id).not.toBe(oldSocketId);
    const restored = await command(memberSocket, 'room:join', { roomId: room.id });
    expect(restored.room.ownerId).toBe(member.id);
    expect(restored.members).toHaveLength(3);
    expect(restored.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: newcomer.id, role: 'member' }),
        expect.objectContaining({ userId: member.id, role: 'owner' }),
      ]),
    );
    expect(restored.pomodoro).toMatchObject({
      roomId: room.id,
      status: 'running',
      phase: 'focus',
      pomodoroSessionId: started.pomodoroSessionId,
      endsAt: started.endsAt,
    });

    const updatedMember = next(memberSocket, 'pomodoro:state');
    const updatedOwner = next(ownerSocket, 'pomodoro:state');
    const paused = await command(memberSocket, 'pomodoro:pause', { roomId: room.id });
    expect(paused.status).toBe('paused');
    for (const state of await Promise.all([updatedMember, updatedOwner]))
      expect(state).toMatchObject({
        roomId: room.id,
        status: 'paused',
        pomodoroSessionId: started.pomodoroSessionId,
        remainingSeconds: paused.remainingSeconds,
      });
  });

  it('evicts every departed tab before notification while the other room and remaining participants keep running', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const other = await registerUser(app, 'other');
    const room = await createRoom(owner, 'One');
    const second = await createRoom(other, 'Two');
    await join(member, room.inviteCode);
    const ownerSocket = await connect(owner);
    const memberA = await connect(member);
    const memberB = await connect(member);
    const otherSocket = await connect(other);
    await command(ownerSocket, 'room:join', { roomId: room.id });
    await command(memberA, 'room:join', { roomId: room.id });
    await command(memberB, 'room:join', { roomId: room.id });
    await command(otherSocket, 'room:join', { roomId: second.id });
    const commonState = next(memberB, 'pomodoro:state');
    const started = await command(ownerSocket, 'pomodoro:start', { roomId: room.id });
    expect(await commonState).toMatchObject({ roomId: room.id, endsAt: started.endsAt });
    const secondBefore = await command(otherSocket, 'room:join', { roomId: second.id });
    expect(secondBefore.pomodoro.status).toBe('idle');
    const removedA = next(memberA, 'room:removed');
    const removedB = next(memberB, 'room:removed');
    const changed = next(ownerSocket, 'room:updated');
    await http().post('/rooms/leave').set(as(member)).expect(200);
    expect(await removedA).toMatchObject({ roomId: room.id, reason: 'left' });
    expect(await removedB).toMatchObject({ roomId: room.id, reason: 'left' });
    expect(await changed).toMatchObject({ roomId: room.id });
    const serverRoom = app.get(RealtimeGateway).server.sockets.adapter.rooms.get(`room:${room.id}`);
    expect(serverRoom?.has(memberA.id!)).toBe(false);
    expect(serverRoom?.has(memberB.id!)).toBe(false);
    expect(serverRoom?.has(ownerSocket.id!)).toBe(true);
    await expect(command(memberA, 'room:join', { roomId: room.id })).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });
    expect(await command(ownerSocket, 'pomodoro:pause', { roomId: room.id })).toMatchObject({
      status: 'paused',
    });
    const secondAfter = await command(otherSocket, 'room:join', { roomId: second.id });
    expect(secondAfter.pomodoro.status).toBe('idle');
  });

  it('closes a room and evicts all tabs of its last member', async () => {
    const owner = await registerUser(app, 'owner');
    const room = await createRoom(owner, 'Closing');
    const a = await connect(owner);
    const b = await connect(owner);
    await command(a, 'room:join', { roomId: room.id });
    await command(b, 'room:join', { roomId: room.id });
    const removedA = next(a, 'room:removed');
    const removedB = next(b, 'room:removed');
    await http().post('/rooms/leave').set(as(owner)).expect(200);
    expect(await removedA).toMatchObject({ roomId: room.id, reason: 'closed' });
    expect(await removedB).toMatchObject({ roomId: room.id, reason: 'closed' });
    expect(app.get(RealtimeGateway).server.sockets.adapter.rooms.has(`room:${room.id}`)).toBe(
      false,
    );
    await expect(command(a, 'room:join', { roomId: room.id })).rejects.toMatchObject({
      code: expect.stringMatching(/ROOM_CLOSED|NOT_IN_ROOM/),
    });
  });

  it('does not retain or emit snapshots to a departed socket when room subscriptions race HTTP leave', async () => {
    const owner = await registerUser(app, 'owner');
    const member = await registerUser(app, 'member');
    const room = await createRoom(owner, 'Race');
    await join(member, room.inviteCode);
    const client = await connect(member);
    await command(client, 'room:join', { roomId: room.id });
    let removed = false;
    let snapshotAfterRemoval = false;
    client.on('room:removed', () => {
      removed = true;
    });
    client.on('room:snapshot', () => {
      if (removed) snapshotAfterRemoval = true;
    });
    const departed = next(client, 'room:removed');
    await Promise.allSettled([
      ...Array.from({ length: 8 }, () => command(client, 'room:join', { roomId: room.id })),
      http().post('/rooms/leave').set(as(member)).expect(200),
    ]);
    await departed;
    expect(snapshotAfterRemoval).toBe(false);
    expect(
      app.get(RealtimeGateway).server.sockets.adapter.rooms.get(`room:${room.id}`)?.has(client.id!),
    ).toBeFalsy();
    await expect(command(client, 'room:join', { roomId: room.id })).rejects.toMatchObject({
      code: 'NOT_IN_ROOM',
    });
  });

  it('rejects malformed room requests and unauthenticated sockets with machine-readable errors', async () => {
    const user = await registerUser(app);
    const client = await connect(user);
    await expect(command(client, 'room:join', { roomId: 'bad-id' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: expect.any(String),
    });
    const invalid = io(endpoint, {
      transports: ['websocket'],
      auth: { token: 'invalid' },
      reconnection: false,
      autoConnect: false,
    });
    clients.push(invalid);
    const error = next(invalid, 'realtime:error');
    invalid.connect();
    expect(await error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('accepts configured origins and rejects foreign origins on websocket handshakes', async () => {
    const origin = app
      .get(ConfigService)
      .getOrThrow<string>('CORS_ORIGINS')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)[0];
    const url = `${endpoint.replace(/^http/, 'ws')}/socket.io/?EIO=4&transport=websocket`;
    const accepted = new WebSocket(url, { origin });
    await new Promise<void>((resolve, reject) => {
      accepted.once('open', () => {
        accepted.close();
        resolve();
      });
      accepted.once('error', reject);
    });
    const denied = new WebSocket(url, { origin: 'https://not-tomato.invalid' });
    await new Promise<void>((resolve, reject) => {
      denied.once('open', () => {
        denied.close();
        reject(new Error('Foreign Origin was accepted'));
      });
      denied.once('unexpected-response', (_request, response) => {
        expect(response.statusCode).toBe(403);
        response.resume();
        denied.terminate();
        resolve();
      });
      denied.once('error', () => {});
    });
    await http()
      .get('/socket.io/?EIO=4&transport=polling')
      .set('Origin', origin)
      .expect('Access-Control-Allow-Origin', origin)
      .expect(200);
  });
});
