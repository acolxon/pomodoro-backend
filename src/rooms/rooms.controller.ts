import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthUser } from '../auth/types/auth-user';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { uuidPipe } from '../common/pipes/uuid.pipe';
import { CreateRoomDto } from './dto/create-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { LeaveRoomResultDto, RoomDto, RoomMemberDto } from './dto/room.dto';
import { TransferOwnerDto } from './dto/transfer-owner.dto';
import { RoomsService } from './rooms.service';

@ApiTags('rooms')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'UNAUTHORIZED — нет или недействителен JWT' })
@Controller('rooms')
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  // ВАЖНО: статические маршруты (join, leave, me) объявляются ДО ':id'.

  @Post()
  @ApiOperation({ summary: 'Создать комнату (создатель становится владельцем)' })
  @ApiCreatedResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR' })
  @ApiConflictResponse({ description: 'ALREADY_IN_ROOM — пользователь уже состоит в комнате' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoomDto): Promise<RoomDto> {
    return this.rooms.createRoom(user.id, dto);
  }

  @Post('join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Вступить в комнату по коду приглашения' })
  @ApiOkResponse({ type: RoomDto })
  @ApiNotFoundResponse({ description: 'INVALID_INVITE_CODE' })
  @ApiConflictResponse({
    description: 'ROOM_CLOSED, ROOM_FULL или ALREADY_IN_ROOM',
  })
  join(@CurrentUser() user: AuthUser, @Body() dto: JoinRoomDto): Promise<RoomDto> {
    return this.rooms.joinRoom(user.id, dto.inviteCode);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Выйти из текущей комнаты',
    description:
      'Если выходит владелец, права получает самый ранний из оставшихся активных участников. ' +
      'Если участников не осталось, комната закрывается.',
  })
  @ApiOkResponse({ type: LeaveRoomResultDto })
  @ApiNotFoundResponse({ description: 'NOT_IN_ROOM — пользователь не состоит в комнате' })
  leave(@CurrentUser() user: AuthUser): Promise<LeaveRoomResultDto> {
    return this.rooms.leaveRoom(user.id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Моя текущая комната' })
  @ApiOkResponse({ type: RoomDto })
  @ApiNotFoundResponse({ description: 'NOT_IN_ROOM — пользователь не состоит в комнате' })
  getMine(@CurrentUser() user: AuthUser): Promise<RoomDto> {
    return this.rooms.getMyRoom(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Информация о комнате (только для её активных участников)' })
  @ApiOkResponse({ type: RoomDto })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND' })
  @ApiForbiddenResponse({ description: 'NOT_IN_ROOM — вы не участник этой комнаты' })
  getOne(@CurrentUser() user: AuthUser, @Param('id', uuidPipe) id: string): Promise<RoomDto> {
    return this.rooms.getRoom(user.id, id);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'Активные участники комнаты в порядке вступления' })
  @ApiOkResponse({ type: [RoomMemberDto] })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND' })
  @ApiForbiddenResponse({ description: 'NOT_IN_ROOM — вы не участник этой комнаты' })
  getMembers(
    @CurrentUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
  ): Promise<RoomMemberDto[]> {
    return this.rooms.getMembers(user.id, id);
  }

  @Patch(':id/owner')
  @ApiOperation({ summary: 'Передать права владельца другому участнику (только владелец)' })
  @ApiOkResponse({ type: RoomDto })
  @ApiBadRequestResponse({ description: 'VALIDATION_ERROR или BAD_REQUEST (передача самому себе)' })
  @ApiNotFoundResponse({ description: 'ROOM_NOT_FOUND или ROOM_MEMBER_NOT_FOUND' })
  @ApiForbiddenResponse({ description: 'NOT_ROOM_OWNER' })
  @ApiConflictResponse({ description: 'ROOM_CLOSED' })
  transferOwner(
    @CurrentUser() user: AuthUser,
    @Param('id', uuidPipe) id: string,
    @Body() dto: TransferOwnerDto,
  ): Promise<RoomDto> {
    return this.rooms.transferOwnership(user.id, id, dto.newOwnerId);
  }
}
