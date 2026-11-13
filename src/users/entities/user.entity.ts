import { Column, CreateDateColumn, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { UserSettings } from './user-settings.entity';
import { UserStats } from './user-stats.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 20 })
  username!: string;

  @Column({ type: 'varchar', length: 255 })
  email!: string;

  /** Хеш пароля (argon2id). Не выбирается из БД, пока явно не запрошен через addSelect. */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash!: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 2048, nullable: true })
  avatarUrl!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToOne(() => UserStats, (stats) => stats.user)
  stats?: UserStats;

  @OneToOne(() => UserSettings, (settings) => settings.user)
  settings?: UserSettings;
}
