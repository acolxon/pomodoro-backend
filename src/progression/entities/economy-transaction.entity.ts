import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Immutable award receipt; source + user is the idempotency key. */
@Entity('economy_transactions')
@Unique('uq_economy_source_user', ['sourceType', 'sourceId', 'userId'])
export class EconomyTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'source_type', type: 'varchar', length: 24 }) sourceType!: 'focus_completed';
  @Column({ name: 'source_id', type: 'uuid' }) sourceId!: string;
  @Column({ type: 'int' }) xp!: number;
  @Column({ type: 'int' }) coins!: number;
  @Column({ name: 'team_bonus', type: 'boolean' }) teamBonus!: boolean;
  @Column({ name: 'activity_date', type: 'date' }) activityDate!: string;
  @Column({ name: 'earned_at', type: 'timestamptz' }) earnedAt!: Date;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
