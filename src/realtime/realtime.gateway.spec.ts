import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { UsersService } from '../users/users.service';
import { RoomChange, RoomsService } from '../rooms/rooms.service';
import { roomErrors } from '../rooms/rooms.errors';
import { PomodoroService } from '../pomodoro/pomodoro.service';
import { RealtimeGateway } from './realtime.gateway';

const roomId = '1c418326-5c2d-4559-8337-ce5a665356a2';

describe('Realtime authorization and error contracts', () => {
  let gateway: RealtimeGateway;
  let rooms: {
    getRoom: jest.Mock;
    getMembers: jest.Mock;
    setChangeListener: jest.Mock;
    withActiveMembership: jest.Mock;
  };
  let pomodoro: {
    getState: jest.Mock;
    readState: jest.Mock;
    stopRoom: jest.Mock;
    start: jest.Mock;
    setReady: jest.Mock;
    leaveFocus: jest.Mock;
    setBroadcaster: jest.Mock;
  };
  let jwt: { verifyAsync: jest.Mock };
  let users: { findById: jest.Mock };
  let broadcast: jest.Mock;
  let operator: {
    emit: jest.Mock;
    socketsLeave: jest.Mock;
    fetchSockets: jest.Mock;
    to: jest.Mock;
  };

  function client(authenticated = true) {
    const channels = new Set(['socket-1']);
    return {
      id: 'socket-1',
      rooms: channels,
      data: authenticated ? { user: { id: 'user-1', username: 'alice' } } : {},
      handshake: { auth: { token: 'token' }, headers: {} },
      join: jest.fn(async (channel: string) => {
        channels.add(channel);
      }),
      leave: jest.fn(async (channel: string) => {
        channels.delete(channel);
      }),
      emit: jest.fn(),
      disconnect: jest.fn(),
    };
  }
  type Client = ReturnType<typeof client>;
  const socket = (value: Client) => value as unknown as Parameters<RealtimeGateway['joinRoom']>[0];

  async function errorOf(action: Promise<unknown>) {
    try {
      await action;
      throw new Error('Expected the websocket handler to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(WsException);
      return (error as WsException).getError();
    }
  }

  beforeEach(() => {
    rooms = {
      getRoom: jest.fn().mockResolvedValue({ id: roomId, name: 'Study' }),
      getMembers: jest.fn().mockResolvedValue([{ userId: 'user-1' }]),
      setChangeListener: jest.fn(),
      withActiveMembership: jest.fn(
        async (_userId: string, _roomId: string, subscribe: (manager: unknown) => Promise<void>) =>
          subscribe({}),
      ),
    };
    pomodoro = {
      getState: jest.fn().mockResolvedValue({ roomId, status: 'idle', serverTime: new Date() }),
      readState: jest.fn().mockResolvedValue({ roomId, status: 'idle', serverTime: new Date() }),
      stopRoom: jest.fn(),
      start: jest.fn().mockResolvedValue({ roomId, status: 'running' }),
      setReady: jest.fn().mockResolvedValue({ roomId, status: 'idle' }),
      leaveFocus: jest.fn().mockResolvedValue({ roomId, status: 'running' }),
      setBroadcaster: jest.fn(),
    };
    jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'user-1' }) };
    users = { findById: jest.fn().mockResolvedValue({ id: 'user-1', username: 'alice' }) };
    gateway = new RealtimeGateway(
      jwt as unknown as JwtService,
      users as unknown as UsersService,
      rooms as unknown as RoomsService,
      pomodoro as unknown as PomodoroService,
    );
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    broadcast = jest.fn();
    operator = {
      emit: broadcast,
      socketsLeave: jest.fn(),
      fetchSockets: jest.fn().mockResolvedValue([]),
      to: jest.fn().mockReturnThis(),
    };
    gateway.server = {
      to: jest.fn().mockReturnValue(operator),
      in: jest.fn().mockReturnValue(operator),
    } as unknown as Server;
  });

  afterEach(() => jest.restoreAllMocks());

  it('subscribes authenticated sockets to their private user channel before reporting ready', async () => {
    const connection = client(false);
    await gateway.handleConnection(socket(connection));
    expect(connection.join).toHaveBeenCalledWith('user:user-1');
    expect(connection.emit).toHaveBeenCalledWith('realtime:ready', { userId: 'user-1' });
    expect(connection.join.mock.invocationCallOrder[0]).toBeLessThan(
      connection.emit.mock.invocationCallOrder[0],
    );
  });

  it('disconnects invalid credentials without joining any private or room channel', async () => {
    const connection = client(false);
    jwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));
    await gateway.handleConnection(socket(connection));
    expect(connection.join).not.toHaveBeenCalled();
    expect(connection.emit).toHaveBeenCalledWith(
      'realtime:error',
      expect.objectContaining({ code: 'UNAUTHORIZED' }),
    );
    expect(connection.disconnect).toHaveBeenCalledWith(true);
  });

  it('guards room subscription with membership serialization and emits the real snapshot', async () => {
    const connection = client();
    const snapshot = await gateway.joinRoom(socket(connection), { roomId });
    expect(rooms.withActiveMembership).toHaveBeenCalledWith('user-1', roomId, expect.any(Function));
    expect(connection.rooms.has(`room:${roomId}`)).toBe(true);
    expect(snapshot).toMatchObject({
      room: { id: roomId },
      members: [{ userId: 'user-1' }],
      pomodoro: { status: 'idle' },
    });
    expect(connection.emit).toHaveBeenCalledWith('room:snapshot', snapshot);
  });

  it('cleans up a channel if membership disappears while the join snapshot is being read', async () => {
    const connection = client();
    rooms.getMembers.mockRejectedValue(roomErrors.notMemberOfRoom());
    expect(await errorOf(gateway.joinRoom(socket(connection), { roomId }))).toMatchObject({
      code: 'NOT_IN_ROOM',
    });
    expect(connection.leave).toHaveBeenCalledWith(`room:${roomId}`);
    expect(connection.rooms.has(`room:${roomId}`)).toBe(false);
    expect(connection.emit).not.toHaveBeenCalledWith('room:snapshot', expect.anything());
  });

  it('preserves domain error codes instead of returning only their text', async () => {
    const connection = client();
    connection.rooms.add(`room:${roomId}`);
    pomodoro.start.mockRejectedValue(roomErrors.notOwner());
    expect(await errorOf(gateway.start(socket(connection), { roomId }))).toMatchObject({
      code: 'NOT_ROOM_OWNER',
      message: expect.any(String),
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('does not expose internal error messages to clients', async () => {
    const connection = client();
    connection.rooms.add(`room:${roomId}`);
    pomodoro.start.mockRejectedValue(new Error('database password=secret at internal-host'));
    const body = await errorOf(gateway.start(socket(connection), { roomId }));
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR', message: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('password');
    expect(JSON.stringify(body)).not.toContain('internal-host');
  });

  it('rejects unauthenticated room access using the structured error format', async () => {
    expect(await errorOf(gateway.joinRoom(socket(client(false)), { roomId }))).toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(rooms.withActiveMembership).not.toHaveBeenCalled();
  });

  it('re-reads metadata and timer under the final room lock after an intervening membership update', async () => {
    const connection = client();
    pomodoro.getState.mockImplementation(async () => {
      rooms.getRoom.mockResolvedValue({ id: roomId, ownerId: 'new-owner' });
      rooms.getMembers.mockResolvedValue([{ userId: 'new-member' }]);
      return { roomId, status: 'running' };
    });
    pomodoro.readState.mockResolvedValue({ roomId, status: 'paused' });
    const result = await gateway.joinRoom(socket(connection), { roomId });
    expect(result).toMatchObject({
      room: { ownerId: 'new-owner' },
      members: [{ userId: 'new-member' }],
      pomodoro: { status: 'paused' },
    });
    expect(pomodoro.readState).toHaveBeenCalledWith(expect.anything(), roomId);
  });

  it('does not run a timer command before channel subscription', async () => {
    expect(await errorOf(gateway.start(socket(client()), { roomId }))).toMatchObject({
      code: 'NOT_IN_ROOM',
    });
    expect(pomodoro.start).not.toHaveBeenCalled();
  });

  it('validates readiness and requires room subscription for personal departure', async () => {
    const connection = client();
    await expect(
      gateway.ready(socket(connection), { roomId, ready: 'yes' as unknown as boolean }),
    ).rejects.toBeInstanceOf(WsException);
    expect(await errorOf(gateway.leaveFocus(socket(connection), { roomId }))).toMatchObject({
      code: 'NOT_IN_ROOM',
    });
    connection.rooms.add(`room:${roomId}`);
    await gateway.ready(socket(connection), { roomId, ready: true });
    expect(pomodoro.setReady).toHaveBeenCalledWith('user-1', roomId, true);
    await gateway.leaveFocus(socket(connection), { roomId });
    expect(pomodoro.leaveFocus).toHaveBeenCalledWith('user-1', roomId);
    expect(broadcast).toHaveBeenCalledWith('room:updated', { roomId });
  });

  it('rejects malformed room IDs before consulting membership or running a command', async () => {
    expect(await errorOf(gateway.joinRoom(socket(client()), { roomId: 'bad-id' }))).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(rooms.withActiveMembership).not.toHaveBeenCalled();
  });

  it('evicts all sockets in a departed user channel before sending removal and invalidating the room', async () => {
    const listener = rooms.setChangeListener.mock.calls[0][0] as (
      change: RoomChange,
    ) => Promise<void>;
    await listener({ roomId, userId: 'user-1', kind: 'left', roomClosed: false });
    expect(gateway.server.in).toHaveBeenCalledWith('user:user-1');
    expect(operator.socketsLeave).toHaveBeenCalledWith(`room:${roomId}`);
    expect(operator.socketsLeave.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0],
    );
    expect(broadcast).toHaveBeenCalledWith('room:removed', { roomId, reason: 'left' });
    expect(broadcast).toHaveBeenCalledWith('room:updated', { roomId });
  });

  it('clears the room timer and evicts the closing channel before notifying affected private channels', async () => {
    const listener = rooms.setChangeListener.mock.calls[0][0] as (
      change: RoomChange,
    ) => Promise<void>;
    operator.fetchSockets.mockResolvedValue([{ data: { user: { id: 'user-2' } } }]);
    await listener({ roomId, userId: 'user-1', kind: 'left', roomClosed: true });
    expect(pomodoro.stopRoom).toHaveBeenCalledWith(roomId);
    expect(gateway.server.in).toHaveBeenCalledWith(`room:${roomId}`);
    expect(operator.socketsLeave).toHaveBeenCalledWith(`room:${roomId}`);
    expect(operator.socketsLeave.mock.invocationCallOrder[0]).toBeLessThan(
      broadcast.mock.invocationCallOrder[0],
    );
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-1');
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-2');
    expect(broadcast).toHaveBeenCalledWith('room:removed', { roomId, reason: 'closed' });
    expect(broadcast).not.toHaveBeenCalledWith('room:updated', expect.anything());
  });
});
