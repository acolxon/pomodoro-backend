import { Logger, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { UsersService } from '../users/users.service';
import { RoomChange, RoomsService } from '../rooms/rooms.service';
import { RoomDto, RoomMemberDto } from '../rooms/dto/room.dto';
import { PomodoroService } from '../pomodoro/pomodoro.service';
import { PomodoroStateDto } from '../pomodoro/dto/pomodoro-state.dto';
import { AuthUser, JwtPayload } from '../auth/types/auth-user';
import { toErrorBody } from '../common/filters/all-exceptions.filter';
import { ErrorCode } from '../common/errors/error-codes';
import { TasksService } from '../tasks/tasks.service';

interface AuthenticatedSocket extends Socket {
  data: { user?: AuthUser };
}
interface RoomPayload {
  roomId: string;
}

// The configured adapter applies CORS and WebSocket Origin validation via ConfigService.
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly rooms: RoomsService,
    private readonly pomodoro: PomodoroService,
    @Optional() tasks?: TasksService,
  ) {
    this.pomodoro.setBroadcaster((roomId, state) => this.broadcastState(roomId, state));
    this.rooms.setChangeListener((change) => this.roomChanged(change));
    tasks?.setReadinessListener((roomId) =>
      this.server?.to(this.channel(roomId)).emit('room:updated', { roomId }),
    );
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      if (!token) throw new Error('Missing token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (!payload?.sub) throw new Error('Invalid token payload');
      const user = await this.users.findById(payload.sub);
      if (!user) throw new Error('User no longer exists');
      client.data.user = { id: user.id, username: user.username };
      await client.join(this.userChannel(user.id));
      client.emit('realtime:ready', { userId: user.id });
    } catch {
      client.emit('realtime:error', {
        code: ErrorCode.UNAUTHORIZED,
        message: 'Недействительный JWT',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('room:join')
  async joinRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    let channel: string | undefined;
    try {
      const user = this.requireUser(client);
      this.validateRoomPayload(body);
      channel = this.channel(body.roomId);
      await this.rooms.withActiveMembership(user.id, body.roomId, () => client.join(channel!));
      // Initialize/advance before taking the final snapshot lock. Calling getState
      // inside that transaction would deadlock on its own room lock.
      await this.pomodoro.getState(user.id, body.roomId);
      let snapshot!: {
        room: RoomDto;
        members: RoomMemberDto[];
        pomodoro: PomodoroStateDto;
        serverTime: Date;
      };
      await this.rooms.withActiveMembership(user.id, body.roomId, async (manager) => {
        const room = await this.rooms.getRoom(user.id, body.roomId, manager);
        const members = await this.rooms.getMembers(user.id, body.roomId, manager);
        const pomodoro = await this.pomodoro.readState(manager, body.roomId);
        snapshot = { room, members, pomodoro, serverTime: new Date() };
        // All room writers take this lock: metadata and timer cannot become stale
        // before the direct emission, and a departed user cannot receive it.
        client.emit('room:snapshot', snapshot);
      });
      return snapshot;
    } catch (error) {
      if (channel) await client.leave(channel);
      throw this.socketException(error);
    }
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: RoomPayload,
  ) {
    try {
      this.requireUser(client);
      this.validateRoomPayload(body);
      await client.leave(this.channel(body.roomId));
      return { roomId: body.roomId, left: true };
    } catch (error) {
      throw this.socketException(error);
    }
  }

  @SubscribeMessage('pomodoro:start')
  async start(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    return this.runCommand(client, body, (userId, roomId) => this.pomodoro.start(userId, roomId));
  }

  @SubscribeMessage('pomodoro:pause')
  async pause(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    return this.runCommand(client, body, (userId, roomId) => this.pomodoro.pause(userId, roomId));
  }

  @SubscribeMessage('pomodoro:resume')
  async resume(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    return this.runCommand(client, body, (userId, roomId) => this.pomodoro.resume(userId, roomId));
  }

  @SubscribeMessage('pomodoro:cancel')
  async cancel(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    return this.runCommand(client, body, (userId, roomId) => this.pomodoro.cancel(userId, roomId));
  }

  @SubscribeMessage('pomodoro:ready')
  async ready(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: RoomPayload & { ready: boolean },
  ) {
    if (typeof body?.ready !== 'boolean')
      throw new WsException({ code: ErrorCode.VALIDATION_ERROR, message: 'Укажите готовность' });
    return this.runCommand(client, body, (userId, roomId) =>
      this.pomodoro.setReady(userId, roomId, body.ready),
    );
  }

  @SubscribeMessage('pomodoro:leave')
  async leaveFocus(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() body: RoomPayload,
  ) {
    return this.runCommand(client, body, (userId, roomId) =>
      this.pomodoro.leaveFocus(userId, roomId),
    );
  }

  private async runCommand(
    client: AuthenticatedSocket,
    body: RoomPayload,
    command: (userId: string, roomId: string) => Promise<PomodoroStateDto>,
  ): Promise<PomodoroStateDto> {
    try {
      const user = this.requireUser(client);
      this.validateRoomPayload(body);
      if (!client.rooms.has(this.channel(body.roomId))) {
        throw new WsException({
          code: ErrorCode.NOT_IN_ROOM,
          message: 'Сначала подключитесь к комнате через room:join',
        });
      }
      const state = await command(user.id, body.roomId);
      this.broadcastState(body.roomId, state);
      return state;
    } catch (error) {
      throw this.socketException(error);
    }
  }

  private async roomChanged(change: RoomChange): Promise<void> {
    if (change.roomClosed) this.pomodoro.stopRoom(change.roomId);
    if (!this.server) return;
    const channel = this.channel(change.roomId);
    if (change.kind === 'left') {
      if (change.roomClosed) {
        const sockets = await this.server.in(channel).fetchSockets();
        const users = new Set<string>([change.userId]);
        sockets.forEach((socket) => {
          if (socket.data.user?.id) users.add(socket.data.user.id);
        });
        this.server.in(channel).socketsLeave(channel);
        for (const userId of users)
          this.server
            .to(this.userChannel(userId))
            .emit('room:removed', { roomId: change.roomId, reason: 'closed' });
      } else {
        this.server.in(this.userChannel(change.userId)).socketsLeave(channel);
        this.server
          .to(this.userChannel(change.userId))
          .emit('room:removed', { roomId: change.roomId, reason: 'left' });
        this.server.to(channel).emit('room:updated', { roomId: change.roomId });
      }
      return;
    }
    let targets = this.server.to(channel);
    if (change.kind === 'created' || change.kind === 'joined')
      targets = targets.to(this.userChannel(change.userId));
    targets.emit('room:updated', { roomId: change.roomId });
  }

  private broadcastState(roomId: string, state: PomodoroStateDto): void {
    this.server?.to(this.channel(roomId)).emit('pomodoro:state', state);
    this.server?.to(this.channel(roomId)).emit('room:updated', { roomId });
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0)
      return authToken.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return null;
  }

  private requireUser(client: AuthenticatedSocket): AuthUser {
    if (!client.data.user)
      throw new WsException({ code: ErrorCode.UNAUTHORIZED, message: 'Необходима авторизация' });
    return client.data.user;
  }

  private validateRoomPayload(body: RoomPayload): void {
    if (
      !body ||
      typeof body.roomId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        body.roomId,
      )
    ) {
      throw new WsException({ code: ErrorCode.VALIDATION_ERROR, message: 'Некорректный roomId' });
    }
  }

  private channel(roomId: string): string {
    return `room:${roomId}`;
  }
  private userChannel(userId: string): string {
    return `user:${userId}`;
  }

  private socketException(error: unknown): WsException {
    if (error instanceof WsException) return error;
    const { code, message } = toErrorBody(error);
    if (code === ErrorCode.INTERNAL_ERROR) this.logger.error('Realtime command failed', error);
    return new WsException({ code, message });
  }
}
