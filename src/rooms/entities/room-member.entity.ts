import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum RoomMemberRole {
  Owner = 'owner',
  Member = 'member',
}

/**
 * Одно участие пользователя в комнате. Повторный вход создаёт НОВУЮ строку,
 * поэтому история предыдущих участий сохраняется. Активное участие: left_at IS NULL.
 */
@Entity('room_members')
export class RoomMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'room_id', type: 'uuid' })
  roomId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 16, default: RoomMemberRole.Member })
  role!: RoomMemberRole;

  /** Значение ставит БД (DEFAULT clock_timestamp()): не передаётся при вставке. */
  @Column({ name: 'joined_at', type: 'timestamptz', insert: false, update: false })
  joinedAt!: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt!: Date | null;
}
