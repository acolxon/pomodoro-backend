import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from './user.entity';

/**
 * Игровой прогресс пользователя. XP, уровень и Coins хранятся ТОЛЬКО здесь
 * Начисления подтверждаются журналом economy_transactions в той же транзакции.
 */
@Entity('user_stats')
export class UserStats {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, (user) => user.stats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'int', default: 0 })
  xp!: number;

  @Column({ type: 'int', default: 1 })
  level!: number;

  @Column({ type: 'int', default: 0 })
  coins!: number;

  @Column({ name: 'sessions_completed', type: 'int', default: 0 })
  sessionsCompleted!: number;

  @Column({ name: 'collab_sessions_completed', type: 'int', default: 0 })
  collabSessionsCompleted!: number;

  @Column({ name: 'active_days', type: 'int', default: 0 })
  activeDays!: number;

  /** Дата в формате YYYY-MM-DD (в часовом поясе пользователя). */
  @Column({ name: 'last_active_date', type: 'date', nullable: true })
  lastActiveDate!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
