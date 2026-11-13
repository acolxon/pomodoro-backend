import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RoomStatus {
  Open = 'open',
  Closed = 'closed',
}

@Entity('rooms')
export class Room {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ name: 'invite_code', type: 'varchar', length: 8 })
  inviteCode!: string;

  @Column({ name: 'max_members', type: 'int', default: 10 })
  maxMembers!: number;

  @Column({ type: 'varchar', length: 16, default: RoomStatus.Open })
  status!: RoomStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
