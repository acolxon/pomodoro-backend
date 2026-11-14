import { Logger } from '@nestjs/common';
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
import { RoomsService } from '../rooms/rooms.service';
import { PomodoroService } from '../pomodoro/pomodoro.service';
import { PomodoroStateDto } from '../pomodoro/dto/pomodoro-state.dto';
import { AuthUser, JwtPayload } from '../auth/types/auth-user';

interface AuthenticatedSocket extends Socket {
  data: { user?: AuthUser };
}
interface RoomPayload { roomId: string; }

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly rooms: RoomsService,
    private readonly pomodoro: PomodoroService,
  ) {
    this.pomodoro.setBroadcaster((roomId, state) => this.broadcastState(roomId, state));
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
      client.emit('realtime:ready', { userId: user.id });
    } catch {
      client.emit('realtime:error', { code: 'UNAUTHORIZED', message: 'Недействительный JWT' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.debug(`Socket disconnected: ${client.id}`);
  }

  @SubscribeMessage('room:join')
  async joinRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    const user = this.requireUser(client);
    this.validateRoomPayload(body);
    try {
      const room = await this.rooms.getRoom(user.id, body.roomId);
      const channel = this.channel(body.roomId);
      await client.join(channel);
      const members = await this.rooms.getMembers(user.id, body.roomId);
      const pomodoro = await this.pomodoro.getState(user.id, body.roomId);
      const snapshot = { room, members, pomodoro, serverTime: new Date() };
      client.emit('room:snapshot', snapshot);
      return snapshot;
    } catch (error) {
      throw new WsException(this.errorMessage(error));
    }
  }

  @SubscribeMessage('room:leave')
  async leaveRoom(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() body: RoomPayload) {
    this.requireUser(client);
    this.validateRoomPayload(body);
    await client.leave(this.channel(body.roomId));
    return { roomId: body.roomId, left: true };
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

  private async runCommand(
    client: AuthenticatedSocket,
    body: RoomPayload,
    command: (userId: string, roomId: string) => Promise<PomodoroStateDto>,
  ): Promise<PomodoroStateDto> {
    const user = this.requireUser(client);
    this.validateRoomPayload(body);
    if (!client.rooms.has(this.channel(body.roomId))) {
      throw new WsException('Сначала подключитесь к комнате через room:join');
    }
    try {
      const state = await command(user.id, body.roomId);
      this.broadcastState(body.roomId, state);
      return state;
    } catch (error) {
      throw new WsException(this.errorMessage(error));
    }
  }

  private broadcastState(roomId: string, state: PomodoroStateDto): void {
    this.server?.to(this.channel(roomId)).emit('pomodoro:state', state);
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) return authToken.replace(/^Bearer\s+/i, '');
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
    return null;
  }

  private requireUser(client: AuthenticatedSocket): AuthUser {
    if (!client.data.user) throw new WsException('Необходима авторизация');
    return client.data.user;
  }

  private validateRoomPayload(body: RoomPayload): void {
    if (!body || typeof body.roomId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.roomId)) {
      throw new WsException('Некорректный roomId');
    }
  }

  private channel(roomId: string): string { return `room:${roomId}`; }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'Не удалось выполнить операцию';
  }
}
