import { ApiProperty } from '@nestjs/swagger';
import { RoomMemberRole } from '../entities/room-member.entity';
import { RoomStatus } from '../entities/room.entity';

export class RoomDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ example: 'Deep Work' }) name!: string;
  @ApiProperty({ format: 'uuid' }) ownerId!: string;
  @ApiProperty({
    example: 'K7M2QX9P',
    description: 'Виден только активным участникам комнаты',
  })
  inviteCode!: string;
  @ApiProperty({ example: 10 }) maxMembers!: number;
  @ApiProperty({ example: 3, description: 'Количество активных участников' }) membersCount!: number;
  @ApiProperty({ enum: RoomStatus, example: RoomStatus.Open }) status!: RoomStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
}

export class RoomMemberDto {
  @ApiProperty({ format: 'uuid' }) userId!: string;
  @ApiProperty({ example: 'alice_01' }) username!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) avatarUrl!: string | null;
  @ApiProperty({ example: 1 }) level!: number;
  @ApiProperty({ enum: RoomMemberRole, example: RoomMemberRole.Member }) role!: RoomMemberRole;
  @ApiProperty({ type: String, format: 'date-time' }) joinedAt!: Date;
  @ApiProperty({ example: false }) ready!: boolean;
  @ApiProperty({ example: 'waiting' }) sessionStatus!:
    'waiting' | 'ready' | 'focusing' | 'left_early' | 'finished' | 'resting' | 'observer';
  @ApiProperty({ type: String, nullable: true }) taskTitle!: string | null;
}

export class LeaveRoomResultDto {
  @ApiProperty({ format: 'uuid' }) roomId!: string;
  @ApiProperty({ description: 'Комната закрыта, потому что в ней никого не осталось' })
  roomClosed!: boolean;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Новый владелец, если вышел владелец и в комнате остались участники',
  })
  newOwnerId!: string | null;
}
