import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('user_settings')
export class UserSettings {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @OneToOne(() => User, (user) => user.settings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Разрешено ли получать «пакости» от других игроков. */
  @Column({ name: 'allow_pranks', type: 'boolean', default: true })
  allowPranks!: boolean;

  /** IANA-часовой пояс (нужен для подсчёта «дней активности»). */
  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone!: string;
}
